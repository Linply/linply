ALTER TABLE "agent_runs" ADD COLUMN "traceId" varchar(32);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "spanId" varchar(16);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "startedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "durationMs" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "inputTokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "outputTokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "totalTokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "llmRequestCount" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "contextWindowTokens" integer;--> statement-breakpoint
CREATE INDEX "idx_agent_runs_traceId" ON "agent_runs" USING btree ("traceId");