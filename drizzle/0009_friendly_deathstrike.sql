CREATE TABLE "agent_tool_effects" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"rootRunId" uuid NOT NULL,
	"runId" uuid NOT NULL,
	"toolName" varchar(128) NOT NULL,
	"argsHash" varchar(64) NOT NULL,
	"result" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "attemptCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "leaseOwner" varchar(128);--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "leaseExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "heartbeatAt" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agent_tool_effects_idempotencyKey" ON "agent_tool_effects" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_effects_rootRunId" ON "agent_tool_effects" USING btree ("rootRunId");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_effects_runId" ON "agent_tool_effects" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_status_lease" ON "agent_runs" USING btree ("status","leaseExpiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chat_messages_agentRunId_role_unique" ON "chat_messages" USING btree ("agentRunId","role") WHERE "chat_messages"."agentRunId" IS NOT NULL;