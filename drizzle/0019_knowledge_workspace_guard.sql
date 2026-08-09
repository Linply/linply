CREATE OR REPLACE FUNCTION "public"."enforce_knowledge_entry_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	"documentWorkspaceId" integer;
BEGIN
	IF NEW."documentId" IS NULL THEN
		RETURN NEW;
	END IF;

	SELECT "workspaceId"
	INTO "documentWorkspaceId"
	FROM "public"."knowledge_documents"
	WHERE "id" = NEW."documentId";

	IF "documentWorkspaceId" IS NULL THEN
		RAISE EXCEPTION 'knowledge document % does not exist', NEW."documentId"
			USING ERRCODE = '23503';
	END IF;

	IF NEW."workspaceId" IS NULL THEN
		NEW."workspaceId" := "documentWorkspaceId";
	ELSIF NEW."workspaceId" <> "documentWorkspaceId" THEN
		RAISE EXCEPTION 'knowledge entry workspace % does not match document % workspace %',
			NEW."workspaceId", NEW."documentId", "documentWorkspaceId"
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "knowledge_base_workspace_guard"
BEFORE INSERT OR UPDATE OF "workspaceId", "documentId"
ON "public"."knowledge_base"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_knowledge_entry_workspace"();
