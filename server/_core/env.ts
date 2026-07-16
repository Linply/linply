export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appBaseUrl:
    process.env.APP_BASE_URL ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  demoAdminEmail: process.env.DEMO_ADMIN_EMAIL ?? "",
  demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD ?? "",
  chatMode: process.env.CHAT_MODE ?? "rag",
  agentTracingEnabled: process.env.AGENT_TRACING_ENABLED === "true",
  agentHandoffsEnabled: process.env.AGENT_HANDOFFS_ENABLED === "true",
  llmProvider: process.env.LLM_PROVIDER ?? "manus",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
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
