DROP INDEX "idx_knowledge_base_embedding_hnsw";--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityScore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_security_events" ADD COLUMN "securityScore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_knowledge_base_embedding_hnsw" ON "knowledge_base" USING hnsw ("embedding" vector_cosine_ops) WHERE "knowledge_base"."embedding" IS NOT NULL AND "knowledge_base"."securityStatus" = 'approved';