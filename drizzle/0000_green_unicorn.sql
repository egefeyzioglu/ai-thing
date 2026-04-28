CREATE TABLE "ai-thing_image" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_id" text NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_image" ADD CONSTRAINT "ai-thing_image_prompt_id_ai-thing_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai-thing_prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_created_at_idx" ON "ai-thing_image" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "image_prompt_id_idx" ON "ai-thing_image" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "prompt_created_at_idx" ON "ai-thing_prompt" USING btree ("created_at");