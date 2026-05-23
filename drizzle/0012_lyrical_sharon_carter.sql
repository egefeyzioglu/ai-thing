CREATE TABLE "ai-thing_generation_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_id" text,
	"model" text NOT NULL,
	"resolution" text,
	"aspect_ratio" text,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_generation_usage" ADD CONSTRAINT "ai-thing_generation_usage_image_id_ai-thing_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ai-thing_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_usage_user_created_idx" ON "ai-thing_generation_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_usage_user_status_created_idx" ON "ai-thing_generation_usage" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "generation_usage_image_idx" ON "ai-thing_generation_usage" USING btree ("image_id");