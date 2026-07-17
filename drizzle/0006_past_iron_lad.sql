CREATE TABLE "oauth_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"stateHash" varchar(64) NOT NULL,
	"codeVerifier" varchar(128) NOT NULL,
	"returnTo" varchar(1024) DEFAULT '/' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_states_stateHash_unique" UNIQUE("stateHash")
);
--> statement-breakpoint
CREATE INDEX "idx_oauth_states_expiresAt" ON "oauth_states" USING btree ("expiresAt");