import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

import type { AiSettings } from "../../shared/aiSettings";
import {
  type AttachmentRejection,
  type MessageAttachment,
  kindForMimeType,
  partitionAttachments,
} from "../../shared/attachments";
import { ENV } from "../_core/env";
import {
  getObjectStorageClient,
  isKnowledgeStorageConfigured,
} from "../knowledge/storage";

/**
 * Attachments travel by reference. The browser uploads straight to object
 * storage with a presigned URL, the message stores only the key, and the bytes
 * are fetched again — and downscaled — at the moment the model is called.
 *
 * The alternative, inlining base64 in Postgres, makes every history read carry
 * megabytes of screenshot it does not need.
 */

export type PreparedAttachments = {
  /** Ready for pi's `prompt(text, { images })`. */
  images: Array<{ type: "image"; data: string; mimeType: string }>;
  /**
   * pi's user messages carry text and images only, so a PDF reaches the model
   * as extracted text rather than as bytes.
   */
  documents: Array<{ fileName: string; text: string; truncated: boolean }>;
  rejected: AttachmentRejection[];
};

const ATTACHMENT_PREFIX = "chat-attachments";

export const isAttachmentStorageConfigured = isKnowledgeStorageConfigured;

/**
 * Keys are namespaced per workspace so a leaked key cannot be walked into
 * another tenant's uploads, and randomised so a customer cannot overwrite an
 * attachment someone else just sent.
 */
export const buildAttachmentStorageKey = (input: {
  workspaceId: number;
  fileName: string;
}) => {
  const safeName = input.fileName.replace(/[^\w.\-一-龥]/g, "_").slice(-80);
  return `${ATTACHMENT_PREFIX}/${input.workspaceId}/${randomUUID()}/${safeName}`;
};

export const createAttachmentUploadUrl = async (input: {
  workspaceId: number;
  fileName: string;
  mimeType: string;
  bytes: number;
  settings: AiSettings;
}) => {
  const kind = kindForMimeType(input.mimeType);
  const limits =
    kind === "image"
      ? {
          blocked: input.settings.images.blockImages,
          allowed: input.settings.images.allowedMimeTypes,
          maxBytes: input.settings.images.maxBytes,
        }
      : {
          blocked: input.settings.files.blockFiles,
          allowed: input.settings.files.allowedMimeTypes,
          maxBytes: input.settings.files.maxBytes,
        };

  // Refused before a byte is uploaded, so the customer is not left waiting on a
  // transfer that the run would drop anyway.
  if (limits.blocked) throw new Error("当前工作区未开启该类型附件。");
  if (!limits.allowed.includes(input.mimeType.toLowerCase())) {
    throw new Error(`暂不支持 ${input.mimeType} 格式。`);
  }
  if (input.bytes > limits.maxBytes) {
    throw new Error(
      `文件超过 ${Math.floor(limits.maxBytes / (1024 * 1024))}MB 上限。`
    );
  }

  const storageKey = buildAttachmentStorageKey(input);
  const url = await getSignedUrl(
    getObjectStorageClient(),
    new PutObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: storageKey,
      ContentType: input.mimeType,
    }),
    { expiresIn: ENV.knowledgeUploadUrlTtlSeconds }
  );

  return {
    storageKey,
    url,
    attachment: {
      id: randomUUID(),
      kind,
      storageKey,
      mimeType: input.mimeType,
      fileName: input.fileName,
      bytes: input.bytes,
    } satisfies MessageAttachment,
  };
};

/**
 * A short-lived read URL for showing an attachment back to the customer.
 *
 * The workspace prefix is re-checked here rather than trusted from the request:
 * the key travels through the browser, and without this check one workspace
 * could ask for a signed URL to another's uploads.
 */
export const createAttachmentDownloadUrl = async (input: {
  workspaceId: number;
  storageKey: string;
}) => {
  const prefix = `${ATTACHMENT_PREFIX}/${input.workspaceId}/`;
  if (!input.storageKey.startsWith(prefix)) {
    throw new Error("无权访问该附件");
  }

  return getSignedUrl(
    getObjectStorageClient(),
    new GetObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: input.storageKey,
    }),
    { expiresIn: 300 }
  );
};

/**
 * The upload happens out of band, so the claimed size is only a claim until the
 * object exists. This is what makes the settings limits real.
 */
export const verifyAttachmentUpload = async (attachment: MessageAttachment) => {
  const head = await getObjectStorageClient().send(
    new HeadObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: attachment.storageKey,
    })
  );
  return {
    ...attachment,
    bytes: head.ContentLength ?? attachment.bytes,
    mimeType: head.ContentType ?? attachment.mimeType,
  } satisfies MessageAttachment;
};

const readStream = async (body: AsyncIterable<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
};

export const loadAttachmentBytes = async (attachment: MessageAttachment) => {
  const result = await getObjectStorageClient().send(
    new GetObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: attachment.storageKey,
    })
  );
  if (!result.Body) throw new Error("对象存储返回了空文件流");
  return readStream(result.Body as AsyncIterable<Uint8Array>);
};

/**
 * pi resizes to 2000x2000 before sending. We do the same, for the same reason:
 * a phone screenshot is far larger than any vision model needs, and the tokens
 * it costs are charged to the workspace either way.
 */
export const resizeImageForModel = async (
  bytes: Buffer,
  mimeType: string,
  settings: AiSettings
): Promise<{ data: Buffer; mimeType: string; resized: boolean }> => {
  if (!settings.images.autoResize) {
    return { data: bytes, mimeType, resized: false };
  }

  try {
    const photon = await import("@silvia-odwyer/photon-node");
    const image = photon.PhotonImage.new_from_byteslice(new Uint8Array(bytes));
    const width = image.get_width();
    const height = image.get_height();
    const longestEdge = Math.max(width, height);
    if (longestEdge <= settings.images.maxDimension) {
      return { data: bytes, mimeType, resized: false };
    }

    const scale = settings.images.maxDimension / longestEdge;
    const resized = photon.resize(
      image,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      1
    );
    // JPEG for the re-encode: a downscaled screenshot does not need alpha, and
    // PNG of a photo is several times the size for no visible gain.
    return {
      data: Buffer.from(resized.get_bytes_jpeg(85)),
      mimeType: "image/jpeg",
      resized: true,
    };
  } catch (error) {
    // A picture we cannot decode is still a picture the model might read.
    console.warn("[Agent] Image resize failed; sending original", {
      mimeType,
      error,
    });
    return { data: bytes, mimeType, resized: false };
  }
};

const extractPdfText = async (bytes: Buffer) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(document, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
};

export const extractDocumentText = async (
  attachment: MessageAttachment,
  bytes: Buffer,
  settings: AiSettings
) => {
  const mimeType = attachment.mimeType.toLowerCase();
  const raw =
    mimeType === "application/pdf"
      ? await extractPdfText(bytes)
      : bytes.toString("utf8");

  const normalized = raw.replace(/\s+\n/g, "\n").trim();
  const limit = settings.files.maxExtractedChars;
  return {
    text: normalized.slice(0, limit),
    truncated: normalized.length > limit,
  };
};

/**
 * Turns stored attachments into what the model can actually be given. Failures
 * are per-attachment: one unreadable PDF must not cost the customer the reply
 * to the question they asked alongside it.
 */
export const prepareAttachmentsForModel = async (
  attachments: MessageAttachment[],
  settings: AiSettings
): Promise<PreparedAttachments> => {
  const { accepted, rejected } = partitionAttachments(attachments, settings);
  const prepared: PreparedAttachments = {
    images: [],
    documents: [],
    rejected: [...rejected],
  };

  if (accepted.length === 0) return prepared;
  if (!isAttachmentStorageConfigured()) {
    console.error(
      "[Agent] Attachments received but object storage is not configured"
    );
    return {
      ...prepared,
      rejected: [
        ...prepared.rejected,
        ...accepted.map(attachment => ({
          attachment,
          reason: "blocked" as const,
          message: `附件存储未配置，已忽略「${attachment.fileName}」。`,
        })),
      ],
    };
  }

  for (const attachment of accepted) {
    try {
      const bytes = await loadAttachmentBytes(attachment);
      if (attachment.kind === "image") {
        const image = await resizeImageForModel(
          bytes,
          attachment.mimeType,
          settings
        );
        prepared.images.push({
          type: "image",
          data: image.data.toString("base64"),
          mimeType: image.mimeType,
        });
        continue;
      }

      const extracted = await extractDocumentText(attachment, bytes, settings);
      if (!extracted.text) {
        prepared.rejected.push({
          attachment,
          reason: "blocked",
          message: `「${attachment.fileName}」没有可提取的文字内容，已忽略。`,
        });
        continue;
      }
      prepared.documents.push({
        fileName: attachment.fileName,
        text: extracted.text,
        truncated: extracted.truncated,
      });
    } catch (error) {
      console.error("[Agent] Failed to prepare attachment", {
        storageKey: attachment.storageKey,
        error,
      });
      prepared.rejected.push({
        attachment,
        reason: "blocked",
        message: `「${attachment.fileName}」读取失败，已忽略。`,
      });
    }
  }

  return prepared;
};
