CREATE TYPE "public"."channel_provider" AS ENUM('web', 'telegram', 'slack', 'feishu');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('pending', 'connected', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step" AS ENUM('profile', 'knowledge', 'preview', 'channel', 'done');--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerUserId" integer NOT NULL,
	"name" varchar(80) NOT NULL,
	"publicKey" varchar(32) NOT NULL,
	"agentName" varchar(60) DEFAULT '智能客服' NOT NULL,
	"agentTone" varchar(16) DEFAULT 'friendly' NOT NULL,
	"greeting" text,
	"fallbackReply" text,
	"businessContext" text,
	"publicChatEnabled" boolean DEFAULT true NOT NULL,
	"onboardingStep" "onboarding_step" DEFAULT 'profile' NOT NULL,
	"onboardingCompletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"provider" "channel_provider" NOT NULL,
	"status" "channel_status" DEFAULT 'pending' NOT NULL,
	"displayName" varchar(120),
	"externalId" varchar(128),
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhookSecret" varchar(64) NOT NULL,
	"deliveryMode" varchar(16) DEFAULT 'webhook' NOT NULL,
	"pollOffset" bigint DEFAULT 0 NOT NULL,
	"autoReply" boolean DEFAULT true NOT NULL,
	"lastEventAt" timestamp with time zone,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"channelId" integer NOT NULL,
	"provider" "channel_provider" NOT NULL,
	"externalId" varchar(128) NOT NULL,
	"externalChatId" varchar(128),
	"displayName" varchar(160),
	"username" varchar(120),
	"locale" varchar(16),
	"messageCount" integer DEFAULT 0 NOT NULL,
	"lastMessageAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerUserId_users_id_fk" FOREIGN KEY ("ownerUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_channels" ADD CONSTRAINT "workspace_channels_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_contacts" ADD CONSTRAINT "channel_contacts_channelId_workspace_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."workspace_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_ownerUserId" ON "workspaces" USING btree ("ownerUserId");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspaces_publicKey" ON "workspaces" USING btree ("publicKey");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspace_channels_workspaceId_provider" ON "workspace_channels" USING btree ("workspaceId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_workspace_channels_webhookSecret" ON "workspace_channels" USING btree ("webhookSecret");--> statement-breakpoint
CREATE INDEX "idx_workspace_channels_workspaceId" ON "workspace_channels" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channel_contacts_channelId_externalId" ON "channel_contacts" USING btree ("channelId","externalId");--> statement-breakpoint
CREATE INDEX "idx_channel_contacts_workspaceId_lastMessageAt" ON "channel_contacts" USING btree ("workspaceId","lastMessageAt");--> statement-breakpoint

--
-- Backfill: give every existing account its own workspace plus a `web` channel,
-- then attach existing rows to the workspace of the user that produced them.
-- New columns are added nullable so the backfill can run before NOT NULL lands.
--
INSERT INTO "workspaces" ("ownerUserId", "name", "publicKey", "onboardingStep", "onboardingCompletedAt")
SELECT
	"id",
	LEFT(COALESCE(NULLIF(TRIM("name"), ''), SPLIT_PART("email", '@', 1)) || ' 的客服', 80),
	SUBSTR(MD5("id"::text || CLOCK_TIMESTAMP()::text || RANDOM()::text), 1, 24),
	'done',
	NOW()
FROM "users"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_channels" ("workspaceId", "provider", "status", "displayName", "webhookSecret", "deliveryMode")
SELECT
	"id",
	'web',
	'connected',
	'分享链接',
	SUBSTR(MD5("id"::text || 'web' || CLOCK_TIMESTAMP()::text || RANDOM()::text), 1, 32),
	'webhook'
FROM "workspaces"
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "tickets" ADD COLUMN "workspaceId" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "contactId" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "channelId" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "workspaceId" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "contactId" integer;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "channelId" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workspaceId" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "contactId" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "channelId" integer;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "workspaceId" integer;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "workspaceId" integer;--> statement-breakpoint

UPDATE "tickets" t SET "workspaceId" = w."id" FROM "workspaces" w WHERE w."ownerUserId" = t."userId";--> statement-breakpoint
UPDATE "chat_messages" c SET "workspaceId" = w."id" FROM "workspaces" w WHERE w."ownerUserId" = c."userId";--> statement-breakpoint
UPDATE "agent_runs" a SET "workspaceId" = w."id" FROM "workspaces" w WHERE w."ownerUserId" = a."userId";--> statement-breakpoint
UPDATE "knowledge_documents" d SET "workspaceId" = w."id" FROM "workspaces" w WHERE w."ownerUserId" = d."uploadedBy";--> statement-breakpoint
UPDATE "knowledge_base" k SET "workspaceId" = d."workspaceId" FROM "knowledge_documents" d WHERE d."id" = k."documentId" AND d."workspaceId" IS NOT NULL;--> statement-breakpoint
--
-- Rows produced before workspaces existed (manual knowledge entries, uploads from a
-- since-deleted account) fall back to the oldest admin workspace, then the oldest workspace.
--
UPDATE "knowledge_documents" SET "workspaceId" = (
	SELECT w."id" FROM "workspaces" w
	JOIN "users" u ON u."id" = w."ownerUserId"
	ORDER BY (u."role" = 'admin') DESC, w."id" ASC
	LIMIT 1
) WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "knowledge_base" SET "workspaceId" = (
	SELECT w."id" FROM "workspaces" w
	JOIN "users" u ON u."id" = w."ownerUserId"
	ORDER BY (u."role" = 'admin') DESC, w."id" ASC
	LIMIT 1
) WHERE "workspaceId" IS NULL;--> statement-breakpoint
--
-- Anything still unattached belongs to a user row that no longer exists; it is
-- unreachable in the workspace-scoped model, so drop it rather than orphan it.
--
DELETE FROM "chat_messages" WHERE "workspaceId" IS NULL;--> statement-breakpoint
DELETE FROM "agent_runs" WHERE "workspaceId" IS NULL;--> statement-breakpoint
DELETE FROM "tickets" WHERE "workspaceId" IS NULL;--> statement-breakpoint
DELETE FROM "knowledge_base" WHERE "workspaceId" IS NULL;--> statement-breakpoint
DELETE FROM "knowledge_documents" WHERE "workspaceId" IS NULL;--> statement-breakpoint

ALTER TABLE "tickets" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_contactId_channel_contacts_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."channel_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_channelId_workspace_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."workspace_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_contactId_channel_contacts_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."channel_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channelId_workspace_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."workspace_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contactId_channel_contacts_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."channel_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_channelId_workspace_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."workspace_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_runs_workspaceId" ON "agent_runs" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_workspaceId" ON "chat_messages" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "idx_chat_messages_contactId_id" ON "chat_messages" USING btree ("contactId","id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_base_workspaceId" ON "knowledge_base" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "idx_knowledge_base_workspaceId_searchable" ON "knowledge_base" USING btree ("workspaceId") WHERE "embedding" IS NOT NULL AND "securityStatus" = 'approved';--> statement-breakpoint
DROP INDEX IF EXISTS "idx_knowledge_base_embedding_hnsw";--> statement-breakpoint
CREATE INDEX "idx_knowledge_documents_workspaceId" ON "knowledge_documents" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "idx_tickets_workspaceId" ON "tickets" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "idx_tickets_contactId" ON "tickets" USING btree ("contactId");
