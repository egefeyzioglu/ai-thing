CREATE TABLE "ai-thing_workshop_message" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"model" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ADD CONSTRAINT "ai-thing_workshop_message_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workshop_message_user_project_created_idx" ON "ai-thing_workshop_message" USING btree ("user_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "workshop_message_project_created_idx" ON "ai-thing_workshop_message" USING btree ("project_id","created_at");