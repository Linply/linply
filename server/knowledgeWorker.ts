import "dotenv/config";
import { createServer } from "node:http";
import { Worker } from "bullmq";
import { ENV } from "./_core/env";
import * as db from "./db";
import {
  processKnowledgeEmbeddingBatch,
  processStoredKnowledgeDocument,
} from "./knowledge/ingest";
import {
  createKnowledgeWorkerConnection,
  KNOWLEDGE_EMBED_QUEUE,
  KNOWLEDGE_PARSE_QUEUE,
  KNOWLEDGE_QUEUE_PREFIX,
  type KnowledgeEmbedJob,
  type KnowledgeParseJob,
} from "./knowledge/queue";
import { abortMultipartUpload } from "./knowledge/storage";

if (!ENV.databaseUrl)
  throw new Error("DATABASE_URL is required for Knowledge worker");
if (!ENV.queueRedisUrl)
  throw new Error("QUEUE_REDIS_URL is required for Knowledge worker");

const parseConnection = createKnowledgeWorkerConnection();
const embedConnection = createKnowledgeWorkerConnection();
const parseWorker = new Worker<KnowledgeParseJob>(
  KNOWLEDGE_PARSE_QUEUE,
  async job =>
    processStoredKnowledgeDocument(job.data.documentId, job.data.uploadVersion),
  {
    connection: parseConnection,
    prefix: KNOWLEDGE_QUEUE_PREFIX,
    concurrency: ENV.knowledgeParseConcurrency,
  }
);
const embedWorker = new Worker<KnowledgeEmbedJob>(
  KNOWLEDGE_EMBED_QUEUE,
  async job =>
    processKnowledgeEmbeddingBatch(job.data.documentId, job.data.entryIds),
  {
    connection: embedConnection,
    prefix: KNOWLEDGE_QUEUE_PREFIX,
    concurrency: ENV.knowledgeEmbedConcurrency,
  }
);

for (const worker of [parseWorker, embedWorker]) {
  worker.on("completed", job => {
    console.log(`[Knowledge Worker] Completed ${worker.name} job`, {
      jobId: job.id,
    });
  });
  worker.on("failed", (job, error) => {
    console.error(`[Knowledge Worker] Failed ${worker.name} job`, {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      error,
    });
  });
  worker.on("error", error => {
    console.error(`[Knowledge Worker] ${worker.name} connection error`, error);
  });
}

const healthServer = process.env.PORT
  ? createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: parseWorker.isRunning() && embedWorker.isRunning(),
          service: "knowledge-worker",
        })
      );
    }).listen(Number(process.env.PORT))
  : null;

async function cleanupExpiredUploads() {
  const before = new Date(
    Date.now() - ENV.knowledgeUploadSessionTtlHours * 60 * 60 * 1000
  );
  const sessions = await db.listExpiredKnowledgeUploadSessions(before);
  for (const session of sessions) {
    if (!session.objectKey || !session.uploadId) continue;
    try {
      await abortMultipartUpload({
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });
      await db.updateKnowledgeDocument(session.id, {
        status: "cancelled",
        uploadId: null,
        failureStage: null,
        error: "上传会话已过期",
      });
    } catch (error) {
      console.error("[Knowledge Worker] Failed to clean expired upload", {
        documentId: session.id,
        error,
      });
    }
  }
}

const cleanupTimer = setInterval(
  () => {
    void cleanupExpiredUploads();
  },
  15 * 60 * 1000
);
cleanupTimer.unref();
void cleanupExpiredUploads();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanupTimer);
  console.log(`[Knowledge Worker] Received ${signal}; stopping`);
  await Promise.all([parseWorker.close(), embedWorker.close()]);
  await Promise.all([parseConnection.quit(), embedConnection.quit()]);
  if (healthServer) {
    await new Promise<void>((resolve, reject) => {
      healthServer.close(error => (error ? reject(error) : resolve()));
    });
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(error => {
      console.error("[Knowledge Worker] Shutdown failed", error);
      process.exitCode = 1;
    });
  });
}

console.log("[Knowledge Worker] Started", {
  parseConcurrency: ENV.knowledgeParseConcurrency,
  embedConcurrency: ENV.knowledgeEmbedConcurrency,
});
