import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ENV } from "../_core/env";

const MAX_MULTIPART_PARTS = 10_000;
const MAX_S3_PART_SIZE = 5 * 1024 * 1024 * 1024;

let storageClient: S3Client | null = null;

export function isKnowledgeStorageConfigured() {
  return Boolean(
    ENV.knowledgeStorageBucket &&
      ENV.knowledgeStorageAccessKeyId &&
      ENV.knowledgeStorageSecretAccessKey
  );
}

function getStorageClient() {
  if (!isKnowledgeStorageConfigured()) {
    throw new Error("知识库对象存储尚未配置");
  }
  if (!storageClient) {
    storageClient = new S3Client({
      endpoint: ENV.knowledgeStorageEndpoint || undefined,
      region: ENV.knowledgeStorageRegion,
      forcePathStyle: ENV.knowledgeStorageForcePathStyle,
      credentials: {
        accessKeyId: ENV.knowledgeStorageAccessKeyId,
        secretAccessKey: ENV.knowledgeStorageSecretAccessKey,
      },
    });
  }
  return storageClient;
}

/**
 * Chat attachments live in the same bucket under their own prefix, so they
 * share this client and its configuration rather than standing up a second one.
 */
export function getObjectStorageClient() {
  return getStorageClient();
}

export function calculateMultipartPartSize(fileSize: number) {
  const configured = ENV.knowledgeUploadPartSizeMb * 1024 * 1024; // 将配置的 MiB 分片大小换算为字节
  const required = Math.ceil(fileSize / MAX_MULTIPART_PARTS); // 为保证分片数不超过 10,000 所需的最小分片大小
  const mib = 1024 * 1024; // 1 MiB 对应的字节数
  const partSize = Math.max(configured, Math.ceil(required / mib) * mib); // 不小于配置值，并将最小需求向上对齐到整 MiB
  if (partSize > MAX_S3_PART_SIZE) {
    throw new Error("文件超过对象存储的 multipart 单对象容量上限"); // 单片超过 S3 允许的 5 GiB 上限，无法上传
  }
  return partSize; // 返回实际采用的单个分片大小（字节）
}

function safeFilename(filename: string) {
  const normalized = filename
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.slice(-120) || "document";
}

export async function createMultipartUpload(input: {
  documentId: number;
  filename: string;
  contentType?: string;
}) {
  const objectKey = `knowledge/${input.documentId}/${randomUUID()}-${safeFilename(input.filename)}`;
  const result = await getStorageClient().send(
    new CreateMultipartUploadCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: objectKey,
      ContentType: input.contentType || "application/octet-stream",
      Metadata: { documentId: String(input.documentId) },
    })
  );
  if (!result.UploadId) throw new Error("对象存储未返回 multipart upload ID");
  return { objectKey, uploadId: result.UploadId };
}

export async function createUploadPartUrls(input: {
  objectKey: string;
  uploadId: string;
  partNumbers: number[];
}) {
  return Promise.all(
    input.partNumbers.map(async partNumber => ({
      partNumber,
      url: await getSignedUrl(
        getStorageClient(),
        new UploadPartCommand({
          Bucket: ENV.knowledgeStorageBucket,
          Key: input.objectKey,
          UploadId: input.uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: ENV.knowledgeUploadUrlTtlSeconds }
      ),
    }))
  );
}

export async function listMultipartParts(input: {
  objectKey: string;
  uploadId: string;
}) {
  const parts: Array<{ partNumber: number; etag: string; size: number }> = [];
  let marker: string | undefined;
  do {
    const result = await getStorageClient().send(
      new ListPartsCommand({
        Bucket: ENV.knowledgeStorageBucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        PartNumberMarker: marker,
      })
    );
    for (const part of result.Parts ?? []) {
      if (part.PartNumber && part.ETag) {
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          size: Number(part.Size ?? 0),
        });
      }
    }
    marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
  } while (marker);
  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

export async function completeMultipartUpload(input: {
  objectKey: string;
  uploadId: string;
  parts?: Array<{ partNumber: number; etag: string; size: number }>;
}) {
  const parts = input.parts ?? (await listMultipartParts(input));
  if (parts.length === 0) throw new Error("尚未上传任何文件分片");
  await getStorageClient().send(
    new CompleteMultipartUploadCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: parts.map(part => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    })
  );
  return {
    parts,
    uploadedBytes: parts.reduce((sum, part) => sum + part.size, 0),
  };
}

export async function getStoredDocumentSize(objectKey: string) {
  const result = await getStorageClient().send(
    new HeadObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: objectKey,
    })
  );
  return Number(result.ContentLength ?? 0);
}

export async function abortMultipartUpload(input: {
  objectKey: string;
  uploadId: string;
}) {
  await getStorageClient().send(
    new AbortMultipartUploadCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
    })
  );
}

export async function deleteStoredDocument(objectKey: string) {
  await getStorageClient().send(
    new DeleteObjectCommand({
      Bucket: ENV.knowledgeStorageBucket,
      Key: objectKey,
    })
  );
}

export async function getStoredDocumentStream(objectKey: string) {
  const result = await getStorageClient().send(
    new GetObjectCommand({ Bucket: ENV.knowledgeStorageBucket, Key: objectKey })
  );
  if (!result.Body) throw new Error("对象存储返回了空文件流");
  return result.Body as AsyncIterable<Uint8Array>;
}
