import { z } from "zod";

import type { AiSettings } from "./aiSettings";

/**
 * What a customer attached to a message. Only the object-storage key and the
 * metadata needed to render and validate it are stored — never the bytes.
 * Postgres rows and agent run records stay small, and the same attachment can
 * be re-read on a retry hours later.
 */

export const MESSAGE_ATTACHMENT_KINDS = ["image", "file"] as const;
export type MessageAttachmentKind = (typeof MESSAGE_ATTACHMENT_KINDS)[number];

export const MessageAttachmentSchema = z.object({
  /** Stable across retries so a replayed run reuses the same attachment. */
  id: z.string().min(1).max(64),
  kind: z.enum(MESSAGE_ATTACHMENT_KINDS),
  /** Object-storage key; the bucket is deployment configuration. */
  storageKey: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  bytes: z.number().int().min(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageAttachmentsSchema = z
  .array(MessageAttachmentSchema)
  .max(20);

export const parseMessageAttachments = (
  value: unknown
): MessageAttachment[] => {
  if (!value) return [];
  const parsed = MessageAttachmentsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};

export const kindForMimeType = (mimeType: string): MessageAttachmentKind =>
  mimeType.toLowerCase().startsWith("image/") ? "image" : "file";

export type AttachmentRejection = {
  attachment: MessageAttachment;
  reason: "blocked" | "mime_type" | "too_large" | "too_many";
  message: string;
};

/**
 * Settings decide what a customer may actually send, so the same document that
 * configures the model also bounds its input. Rejections are returned rather
 * than thrown: one oversized screenshot should not fail a message that also
 * carries a usable one, and the customer is told what was dropped.
 */
export const partitionAttachments = (
  attachments: MessageAttachment[],
  settings: AiSettings
): { accepted: MessageAttachment[]; rejected: AttachmentRejection[] } => {
  const accepted: MessageAttachment[] = [];
  const rejected: AttachmentRejection[] = [];
  const counts: Record<MessageAttachmentKind, number> = { image: 0, file: 0 };

  for (const attachment of attachments) {
    const kind = attachment.kind;
    const limits =
      kind === "image"
        ? {
            blocked: settings.images.blockImages,
            allowed: settings.images.allowedMimeTypes,
            maxBytes: settings.images.maxBytes,
            maxPerMessage: settings.images.maxPerMessage,
            label: "图片",
          }
        : {
            blocked: settings.files.blockFiles,
            allowed: settings.files.allowedMimeTypes,
            maxBytes: settings.files.maxBytes,
            maxPerMessage: settings.files.maxPerMessage,
            label: "文件",
          };

    const reject = (reason: AttachmentRejection["reason"], message: string) =>
      rejected.push({ attachment, reason, message });

    if (limits.blocked) {
      reject(
        "blocked",
        `${limits.label}功能未开启，已忽略「${attachment.fileName}」。`
      );
      continue;
    }
    if (!limits.allowed.includes(attachment.mimeType.toLowerCase())) {
      reject(
        "mime_type",
        `暂不支持 ${attachment.mimeType} 格式，已忽略「${attachment.fileName}」。`
      );
      continue;
    }
    if (attachment.bytes > limits.maxBytes) {
      reject(
        "too_large",
        `「${attachment.fileName}」超过 ${Math.floor(limits.maxBytes / (1024 * 1024))}MB 上限，已忽略。`
      );
      continue;
    }
    if (counts[kind] >= limits.maxPerMessage) {
      reject(
        "too_many",
        `每条消息最多 ${limits.maxPerMessage} 个${limits.label}，已忽略「${attachment.fileName}」。`
      );
      continue;
    }

    counts[kind] += 1;
    accepted.push(attachment);
  }

  return { accepted, rejected };
};
