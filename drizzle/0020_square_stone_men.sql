ALTER TABLE "agent_runs" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "agentSettings" jsonb;