import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { ENV } from "../_core/env";

export const KNOWLEDGE_PARSE_QUEUE = "knowledge-parse";
export const KNOWLEDGE_EMBED_QUEUE = "knowledge-embed";
export const KNOWLEDGE_QUEUE_PREFIX = "bull:knowledge";

export type KnowledgeParseJob = {
  documentId: number;
  uploadVersion: number;
};

export type KnowledgeEmbedJob = {
  documentId: number;
  entryIds: number[];
};

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
};

let queueConnection: IORedis | null = null;
let parseQueue: Queue<KnowledgeParseJob> | null = null;
let embedQueue: Queue<KnowledgeEmbedJob> | null = null;

export function isKnowledgeQueueConfigured() {
  return Boolean(ENV.queueRedisUrl);
}

function getQueueConnection() {
  if (!ENV.queueRedisUrl) throw new Error("QUEUE_REDIS_URL 未配置");
  if (!queueConnection) {
    queueConnection = new IORedis(ENV.queueRedisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }
  return queueConnection;
}

export function createKnowledgeWorkerConnection() {
  if (!ENV.queueRedisUrl) throw new Error("QUEUE_REDIS_URL 未配置");
  return new IORedis(ENV.queueRedisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

function getParseQueue() {
  parseQueue ??= new Queue<KnowledgeParseJob>(KNOWLEDGE_PARSE_QUEUE, {
    connection: getQueueConnection(),
    prefix: KNOWLEDGE_QUEUE_PREFIX,
    defaultJobOptions,
  });
  return parseQueue;
}

function getEmbedQueue() {
  embedQueue ??= new Queue<KnowledgeEmbedJob>(KNOWLEDGE_EMBED_QUEUE, {
    connection: getQueueConnection(),
    prefix: KNOWLEDGE_QUEUE_PREFIX,
    defaultJobOptions,
  });
  return embedQueue;
}

export async function enqueueKnowledgeParse(job: KnowledgeParseJob) {
  return getParseQueue().add("parse", job, {
    jobId: `parse-${job.documentId}-v${job.uploadVersion}`,
  });
}

export async function enqueueKnowledgeEmbed(job: KnowledgeEmbedJob) {
  const first = job.entryIds[0] ?? 0;
  const last = job.entryIds.at(-1) ?? 0;
  return getEmbedQueue().add("embed", job, {
    jobId: `embed-${job.documentId}-${first}-${last}`,
  });
}

export async function closeKnowledgeQueues() {
  await Promise.all([parseQueue?.close(), embedQueue?.close()]);
  parseQueue = null;
  embedQueue = null;
  if (queueConnection) await queueConnection.quit();
  queueConnection = null;
}
