ALTER TYPE "public"."knowledge_document_status" ADD VALUE 'uploading' BEFORE 'parsing';--> statement-breakpoint
ALTER TYPE "public"."knowledge_document_status" ADD VALUE 'uploaded' BEFORE 'parsing';--> statement-breakpoint
ALTER TYPE "public"."knowledge_document_status" ADD VALUE 'parse_queued' BEFORE 'parsing';--> statement-breakpoint
ALTER TYPE "public"."knowledge_document_status" ADD VALUE 'embed_queued' BEFORE 'indexing';--> statement-breakpoint
ALTER TYPE "public"."knowledge_document_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "objectKey" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "uploadId" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "uploadVersion" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "fileSize" bigint;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "uploadPartSize" bigint;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "uploadedBytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "contentType" varchar(128);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "category" varchar(128);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "parsedChunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "failureStage" varchar(32);--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "completedAt" timestamp with time zone;