CREATE TYPE "public"."knowledge_security_event_action" AS ENUM('scan', 'rescan', 'approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."knowledge_security_status" AS ENUM('pending', 'approved', 'quarantined', 'rejected');--> statement-breakpoint
CREATE TABLE "knowledge_security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"knowledgeId" integer NOT NULL,
	"documentId" integer,
	"action" "knowledge_security_event_action" NOT NULL,
	"fromStatus" "knowledge_security_status",
	"toStatus" "knowledge_security_status" NOT NULL,
	"scannerVersion" varchar(64) NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"actorUserId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityStatus" "knowledge_security_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityScannerVersion" varchar(64) DEFAULT 'legacy-approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityContentHash" varchar(64);--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityFindings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityReviewedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityReviewedBy" integer;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityReviewReason" text;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "securityScannedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "approvedChunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "quarantinedChunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "rejectedChunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "pendingSecurityChunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Compatibility backfill: pre-existing entries are explicitly trusted as legacy-approved.
UPDATE "knowledge_base"
SET "securityStatus" = 'approved',
    "securityScannerVersion" = 'legacy-approved',
    "securityFindings" = '[]'::jsonb
WHERE "securityScannerVersion" = 'legacy-approved';--> statement-breakpoint
UPDATE "knowledge_documents" AS d
SET "approvedChunks" = counts.approved
FROM (
  SELECT "documentId", count(*)::integer AS approved
  FROM "knowledge_base"
  WHERE "documentId" IS NOT NULL AND "securityStatus" = 'approved'
  GROUP BY "documentId"
) AS counts
WHERE d."id" = counts."documentId";--> statement-breakpoint
CREATE INDEX "idx_knowledge_security_events_knowledgeId" ON "knowledge_security_events" USING btree ("knowledgeId");--> statement-breakpoint
CREATE INDEX "idx_knowledge_security_events_documentId" ON "knowledge_security_events" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "idx_knowledge_security_events_createdAt" ON "knowledge_security_events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_knowledge_base_securityStatus" ON "knowledge_base" USING btree ("securityStatus");