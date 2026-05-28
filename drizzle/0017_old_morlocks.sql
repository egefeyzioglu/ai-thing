CREATE TABLE "ai-thing_workshop_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "ai-thing_workshop_thread" ("id", "user_id", "project_id", "title", "created_at", "updated_at")
SELECT
	'legacy-' || md5("user_id" || ':' || "project_id"),
	"user_id",
	"project_id",
	'Workshop history',
	min("created_at"),
	max("created_at")
FROM "ai-thing_workshop_message"
GROUP BY "user_id", "project_id";--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ADD COLUMN "thread_id" text;--> statement-breakpoint
UPDATE "ai-thing_workshop_message"
SET "thread_id" = 'legacy-' || md5("user_id" || ':' || "project_id");--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ALTER COLUMN "thread_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_thread" ADD CONSTRAINT "ai-thing_workshop_thread_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workshop_thread_user_project_updated_idx" ON "ai-thing_workshop_thread" USING btree ("user_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "workshop_thread_project_updated_idx" ON "ai-thing_workshop_thread" USING btree ("project_id","updated_at");--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ADD CONSTRAINT "ai-thing_workshop_message_thread_id_ai-thing_workshop_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ai-thing_workshop_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workshop_message_thread_created_idx" ON "ai-thing_workshop_message" USING btree ("thread_id","created_at");
