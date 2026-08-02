CREATE TABLE "auth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"providerAccountId" varchar(320) NOT NULL,
	"passwordHash" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	"ipAddress" varchar(64),
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
-- Legacy external identities are intentionally not migrated. The project owner
-- approved clearing historical business data before enforcing the new schema.
TRUNCATE TABLE "agent_run_steps", "agent_runs", "chat_messages", "ticket_notes", "tickets", "knowledge_base", "knowledge_documents", "auth_accounts", "sessions", "users" RESTART IDENTITY CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_openId_unique";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET DATA TYPE varchar(80);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "lastSignedIn" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "lastSignedIn" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatarUrl" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "disabledAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_auth_accounts_provider_account" ON "auth_accounts" USING btree ("provider","providerAccountId");--> statement-breakpoint
CREATE INDEX "idx_auth_accounts_userId" ON "auth_accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_sessions_userId" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_sessions_expiresAt" ON "sessions" USING btree ("expiresAt");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "openId";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "loginMethod";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
