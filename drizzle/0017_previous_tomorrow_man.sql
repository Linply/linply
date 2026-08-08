CREATE TYPE "public"."plan_request_status" AS ENUM('pending', 'approved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workspace_plan" AS ENUM('free', 'pro', 'business', 'self_hosted');--> statement-breakpoint
CREATE TABLE "plan_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"requestedBy" integer NOT NULL,
	"fromPlan" "workspace_plan" NOT NULL,
	"toPlan" "workspace_plan" NOT NULL,
	"status" "plan_request_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" "workspace_plan" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "planActivatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_requestedBy_users_id_fk" FOREIGN KEY ("requestedBy") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_requests_workspaceId" ON "plan_requests" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plan_requests_open_unique" ON "plan_requests" USING btree ("workspaceId") WHERE status = 'pending';