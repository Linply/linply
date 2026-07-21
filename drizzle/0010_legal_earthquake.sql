CREATE TABLE "agent_tool_invocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"rootRunId" uuid NOT NULL,
	"runId" uuid NOT NULL,
	"toolCallId" varchar(255) NOT NULL,
	"toolName" varchar(128) NOT NULL,
	"argsHash" varchar(64) NOT NULL,
	"idempotencyKey" varchar(255),
	"args" jsonb NOT NULL,
	"result" jsonb,
	"status" varchar(32) NOT NULL,
	"error" text,
	"errorType" varchar(32),
	"retryCount" integer DEFAULT 0 NOT NULL,
	"replayedFromInvocationId" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_agent_tool_invocations_runId" ON "agent_tool_invocations" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_invocations_rootRunId" ON "agent_tool_invocations" USING btree ("rootRunId");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_invocations_runId_toolCallId" ON "agent_tool_invocations" USING btree ("runId","toolCallId");--> statement-breakpoint
CREATE INDEX "idx_agent_tool_invocations_replay" ON "agent_tool_invocations" USING btree ("rootRunId","toolName","argsHash","status");