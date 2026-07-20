CREATE TABLE "agent_run_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"runId" uuid NOT NULL,
	"eventType" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_agent_run_events_runId" ON "agent_run_events" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "idx_agent_run_events_runId_id" ON "agent_run_events" USING btree ("runId","id");