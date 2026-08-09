import { config } from "dotenv";

config({ path: [".env.local", ".env"] });
import {
  createEmbedding,
  getEmbeddingProviderConfig,
} from "../server/_core/embeddings.ts";
import { ENV } from "../server/_core/env.ts";
import { resolveOpenAiApiUrl } from "../server/_core/openai.ts";

async function main() {
  if (!ENV.ragEmbeddingsEnabled) {
    console.log(
      "RAG_EMBEDDINGS_ENABLED=false; temporarily skipping embedding calls."
    );
    return;
  }

  const config = getEmbeddingProviderConfig();
  if (config.requiresApiKey && !config.apiKey) {
    const envName =
      config.provider === "voyage" ? "VOYAGE_API_KEY" : "OPENAI_API_KEY";
    throw new Error(`${envName} is required to check embeddings`);
  }

  const url = resolveOpenAiApiUrl(config.path, {
    baseUrl: config.baseUrl,
  });
  const startedAt = Date.now();

  console.log(`Embedding provider: ${config.provider}`);
  console.log(`Embedding endpoint: ${url}`);
  console.log(`Embedding model: ${config.model}`);

  const embedding = await createEmbedding(
    "客服知识库 embedding connectivity check",
    "query"
  );

  console.log(`Embedding dimension: ${embedding.length}`);
  console.log(`Completed in ${Date.now() - startedAt}ms`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
