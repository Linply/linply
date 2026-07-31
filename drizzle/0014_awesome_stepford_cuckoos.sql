CREATE TYPE "public"."agent_token_ledger_status" AS ENUM('reserved', 'settled', 'released');--> statement-breakpoint
CREATE TYPE "public"."agent_token_usage_state" AS ENUM('reserved', 'actual', 'no_model', 'unknown');--> statement-breakpoint
CREATE TABLE "agent_token_attempt_ledgers" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"attemptNumber" integer NOT NULL,
	"bucketDate" date NOT NULL,
	"status" "agent_token_ledger_status" DEFAULT 'reserved' NOT NULL,
	"usageState" "agent_token_usage_state" DEFAULT 'reserved' NOT NULL,
	"reservedTokens" integer DEFAULT 0 NOT NULL,
	"inputTokens" integer,
	"outputTokens" integer,
	"totalTokens" integer,
	"countedTokens" integer DEFAULT 0 NOT NULL,
	"llmProvider" varchar(32),
	"llmModel" varchar(128),
	"modelStartedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"settledAt" timestamp with time zone,
	CONSTRAINT "chk_agent_token_attempt_ledgers_attempt_positive" CHECK ("agent_token_attempt_ledgers"."attemptNumber" > 0),
	CONSTRAINT "chk_agent_token_attempt_ledgers_tokens_non_negative" CHECK ("agent_token_attempt_ledgers"."reservedTokens" >= 0 AND "agent_token_attempt_ledgers"."countedTokens" >= 0 AND ("agent_token_attempt_ledgers"."inputTokens" IS NULL OR "agent_token_attempt_ledgers"."inputTokens" >= 0) AND ("agent_token_attempt_ledgers"."outputTokens" IS NULL OR "agent_token_attempt_ledgers"."outputTokens" >= 0) AND ("agent_token_attempt_ledgers"."totalTokens" IS NULL OR "agent_token_attempt_ledgers"."totalTokens" >= 0))
);
--> statement-breakpoint
CREATE TABLE "agent_token_daily_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"bucketDate" date NOT NULL,
	"quotaLimitTokens" integer DEFAULT 0 NOT NULL,
	"reservedTokens" integer DEFAULT 0 NOT NULL,
	"usedTokens" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_agent_token_daily_buckets_non_negative" CHECK ("agent_token_daily_buckets"."quotaLimitTokens" >= 0 AND "agent_token_daily_buckets"."reservedTokens" >= 0 AND "agent_token_daily_buckets"."usedTokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "quotaBucketDate" date;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "quotaLimitTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "quotaEnforced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "quotaAdminExempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "reservedTokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "usageState" "agent_token_usage_state" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "countedTokens" integer;--> statement-breakpoint
-- Historical runs intentionally remain outside today's quota: no bucket or ledger
-- rows are backfilled, and quotaBucketDate stays NULL for all pre-migration runs.
ALTER TABLE "agent_token_attempt_ledgers" ADD CONSTRAINT "agent_token_attempt_ledgers_runId_agent_runs_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_token_attempt_ledgers_runId_attemptNumber" ON "agent_token_attempt_ledgers" USING btree ("runId","attemptNumber");--> statement-breakpoint
CREATE INDEX "idx_agent_token_attempt_ledgers_userId_bucketDate" ON "agent_token_attempt_ledgers" USING btree ("userId","bucketDate");--> statement-breakpoint
CREATE INDEX "idx_agent_token_attempt_ledgers_bucketDate_status" ON "agent_token_attempt_ledgers" USING btree ("bucketDate","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_token_daily_buckets_userId_bucketDate" ON "agent_token_daily_buckets" USING btree ("userId","bucketDate");--> statement-breakpoint
CREATE INDEX "idx_agent_token_daily_buckets_bucketDate" ON "agent_token_daily_buckets" USING btree ("bucketDate");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_userId_quotaBucketDate" ON "agent_runs" USING btree ("userId","quotaBucketDate");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "chk_agent_runs_quota_snapshot_non_negative" CHECK ("agent_runs"."quotaLimitTokens" >= 0 AND "agent_runs"."reservedTokens" >= 0 AND ("agent_runs"."inputTokens" IS NULL OR "agent_runs"."inputTokens" >= 0) AND ("agent_runs"."outputTokens" IS NULL OR "agent_runs"."outputTokens" >= 0) AND ("agent_runs"."totalTokens" IS NULL OR "agent_runs"."totalTokens" >= 0) AND ("agent_runs"."countedTokens" IS NULL OR "agent_runs"."countedTokens" >= 0));