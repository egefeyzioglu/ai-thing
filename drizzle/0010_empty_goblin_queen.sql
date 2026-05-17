CREATE TABLE "ai-thing_project" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_prompt" ADD COLUMN "project_id" text;--> statement-breakpoint
INSERT INTO "ai-thing_project" ("id", "user_id", "name", "is_default")
SELECT DISTINCT 'default-' || md5("user_id"), "user_id", 'Default Project', true
FROM "ai-thing_prompt"
WHERE "user_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "ai-thing_project" ("id", "user_id", "name", "is_default")
SELECT 'legacy-null-user-default-project', '__legacy__', 'Legacy Project', true
WHERE EXISTS (
	SELECT 1 FROM "ai-thing_prompt" WHERE "user_id" IS NULL
);--> statement-breakpoint
UPDATE "ai-thing_prompt"
SET "project_id" = CASE
	WHEN "user_id" IS NULL THEN 'legacy-null-user-default-project'
	ELSE 'default-' || md5("user_id")
END;--> statement-breakpoint
ALTER TABLE "ai-thing_prompt" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "project_user_id_idx" ON "ai-thing_project" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_user_name_unique" ON "ai-thing_project" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "project_user_default_idx" ON "ai-thing_project" USING btree ("user_id","is_default");--> statement-breakpoint
ALTER TABLE "ai-thing_prompt" ADD CONSTRAINT "ai-thing_prompt_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_project_created_at_idx" ON "ai-thing_prompt" USING btree ("project_id","created_at");
