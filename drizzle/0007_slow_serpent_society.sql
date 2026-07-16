DROP TABLE IF EXISTS "agent_run_steps";--> statement-breakpoint
DROP TABLE IF EXISTS "agent_runs";--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" integer NOT NULL,
	"ticketId" integer,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"input" text NOT NULL,
	"finalOutput" text,
	"error" text,
	"llmProvider" varchar(32),
	"llmModel" varchar(128),
	"retryOfRunId" uuid,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" uuid NOT NULL,
	"stepType" "agent_run_step_type" NOT NULL,
	"toolName" varchar(128),
	"argsSummary" text,
	"resultSummary" text,
	"content" text,
	"error" text,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "agentRunId" uuid;--> statement-breakpoint
CREATE INDEX "idx_agent_runs_userId" ON "agent_runs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_ticketId" ON "agent_runs" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_status" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_agent_runs_retryOfRunId" ON "agent_runs" USING btree ("retryOfRunId");--> statement-breakpoint
CREATE INDEX "idx_agent_run_steps_runId" ON "agent_run_steps" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "idx_agent_run_steps_stepType" ON "agent_run_steps" USING btree ("stepType");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_agentRunId" ON "chat_messages" USING btree ("agentRunId");
