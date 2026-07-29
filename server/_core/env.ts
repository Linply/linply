const boundedNumber = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
};

export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appBaseUrl:
    process.env.APP_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  demoAdminEmail: process.env.DEMO_ADMIN_EMAIL ?? "",
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  sessionCacheTtlMs: boundedNumber(
    process.env.SESSION_CACHE_TTL_MS,
    60_000,
    1_000,
    5 * 60_000
  ),
  sessionCacheConnectTimeoutMs: boundedNumber(
    process.env.SESSION_CACHE_CONNECT_TIMEOUT_MS,
    1_000,
    100,
    10_000
  ),
  sessionCacheCommandTimeoutMs: boundedNumber(
    process.env.SESSION_CACHE_COMMAND_TIMEOUT_MS,
    250,
    50,
    5_000
  ),
  agentTracingEnabled: process.env.AGENT_TRACING_ENABLED === "true",
  agentHandoffsEnabled: process.env.AGENT_HANDOFFS_ENABLED === "true",
  agentExecutionMode:
    process.env.AGENT_EXECUTION_MODE === "worker" ? "worker" : "inline",
  agentWorkerPollMs: Number(process.env.AGENT_WORKER_POLL_MS ?? 500),
  agentWorkerLeaseMs: Number(process.env.AGENT_WORKER_LEASE_MS ?? 60_000),
  agentWorkerMaxAttempts: Number(process.env.AGENT_WORKER_MAX_ATTEMPTS ?? 3),
  otelEnabled:
    process.env.OTEL_ENABLED === "true" ||
    (process.env.OTEL_ENABLED === undefined &&
      Boolean(
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
          process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      )),
  otelServiceNamespace:
    process.env.OTEL_SERVICE_NAMESPACE ?? "customer-service-agent",
  isProduction: process.env.NODE_ENV === "production",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
  openAiContextWindowTokens: Math.max(
    0,
    Number(process.env.OPENAI_CONTEXT_WINDOW_TOKENS ?? 272_000)
  ),
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  openAiEmbeddingBaseUrl:
    process.env.OPENAI_EMBEDDING_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com",
  openAiEmbeddingPath: process.env.OPENAI_EMBEDDING_PATH ?? "/v1/embeddings",
  embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "local",
  localEmbeddingApiKey: process.env.LOCAL_EMBEDDING_API_KEY ?? "",
  localEmbeddingBaseUrl:
    process.env.LOCAL_EMBEDDING_BASE_URL ?? "http://localhost:8080",
  localEmbeddingModel: process.env.LOCAL_EMBEDDING_MODEL ?? "BAAI/bge-small-zh-v1.5",
  localEmbeddingPath: process.env.LOCAL_EMBEDDING_PATH ?? "/v1/embeddings",
  voyageApiKey: process.env.VOYAGE_API_KEY ?? "",
  voyageBaseUrl: process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com",
  voyageEmbeddingModel: process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3-large",
  voyageEmbeddingPath: process.env.VOYAGE_EMBEDDING_PATH ?? "/v1/embeddings",
  ragEmbeddingsEnabled: process.env.RAG_EMBEDDINGS_ENABLED !== "false",
};
