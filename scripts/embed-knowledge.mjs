import { config } from "dotenv";

config({ path: [".env.local", ".env"] });
import {
  buildKnowledgeEmbeddingInput,
  createEmbedding,
  getEmbeddingProviderConfig,
} from "../server/_core/embeddings.ts";
import {
  listKnowledgeEntries,
  updateKnowledgeEmbedding,
} from "../server/db.ts";

async function main() {
  if (process.env.RAG_EMBEDDINGS_ENABLED === "false") {
    throw new Error(
      "RAG_EMBEDDINGS_ENABLED=false, skip embedding backfill until the embedding endpoint is available"
    );
  }
  const config = getEmbeddingProviderConfig();
  if (config.requiresApiKey && !config.apiKey) {
    const envName =
      config.provider === "voyage" ? "VOYAGE_API_KEY" : "OPENAI_API_KEY";
    throw new Error(`${envName} is required to generate knowledge embeddings`);
  }

  const entries = await listKnowledgeEntries();
  let updated = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (Array.isArray(entry.embedding) && entry.embedding.length > 0) {
      skipped += 1;
      continue;
    }

    const input = buildKnowledgeEmbeddingInput(entry);
    const embedding = await createEmbedding(input, "document");
    await updateKnowledgeEmbedding(entry.id, embedding);
    updated += 1;
    console.log(`Embedded #${entry.id}: ${entry.title}`);
  }

  console.log(`Embedding complete. Updated: ${updated}, skipped: ${skipped}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
