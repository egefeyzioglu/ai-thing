ALTER TABLE "ai-thing_image" RENAME TO "ai-thing_media";--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" RENAME COLUMN "image_id" TO "media_id";--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" RENAME COLUMN "output_image_count" TO "output_count";--> statement-breakpoint
ALTER TABLE "ai-thing_generation_usage" RENAME COLUMN "image_id" TO "media_id";--> statement-breakpoint
ALTER TABLE "ai-thing_reference" RENAME COLUMN "reused_from_image_id" TO "reused_from_media_id";--> statement-breakpoint
ALTER TABLE "ai-thing_reference" DROP CONSTRAINT "ai-thing_reference_reused_from_image_id_unique";--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" DROP CONSTRAINT "ai-thing_generation_cost_event_image_id_ai-thing_image_id_fk";
--> statement-breakpoint
ALTER TABLE "ai-thing_generation_usage" DROP CONSTRAINT "ai-thing_generation_usage_image_id_ai-thing_image_id_fk";
--> statement-breakpoint
ALTER TABLE "ai-thing_media" DROP CONSTRAINT "ai-thing_image_prompt_id_ai-thing_prompt_id_fk";
--> statement-breakpoint
ALTER TABLE "ai-thing_reference" DROP CONSTRAINT "ai-thing_reference_reused_from_image_id_ai-thing_image_id_fk";
--> statement-breakpoint
DROP INDEX "generation_cost_event_image_idx";--> statement-breakpoint
DROP INDEX "generation_usage_image_idx";--> statement-breakpoint
DROP INDEX "image_created_at_idx";--> statement-breakpoint
DROP INDEX "image_prompt_id_idx";--> statement-breakpoint
DROP INDEX "image_user_id_idx";--> statement-breakpoint
DROP INDEX "reference_reused_from_idx";--> statement-breakpoint
ALTER TABLE "ai-thing_media" ALTER COLUMN "mime_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" ADD COLUMN "output_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai-thing_media" ADD COLUMN "type" text NOT NULL DEFAULT 'image';--> statement-breakpoint
ALTER TABLE "ai-thing_media" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai-thing_media" ADD COLUMN "provider_status" text;--> statement-breakpoint
ALTER TABLE "ai-thing_media" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" ADD CONSTRAINT "ai-thing_generation_cost_event_media_id_ai-thing_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ai-thing_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_generation_usage" ADD CONSTRAINT "ai-thing_generation_usage_media_id_ai-thing_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."ai-thing_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_media" ADD CONSTRAINT "ai-thing_media_prompt_id_ai-thing_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai-thing_prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_reference" ADD CONSTRAINT "ai-thing_reference_reused_from_media_id_ai-thing_media_id_fk" FOREIGN KEY ("reused_from_media_id") REFERENCES "public"."ai-thing_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_cost_event_media_idx" ON "ai-thing_generation_cost_event" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "generation_usage_media_idx" ON "ai-thing_generation_usage" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "ai-thing_media" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "media_prompt_id_idx" ON "ai-thing_media" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "media_user_type_created_idx" ON "ai-thing_media" USING btree ("user_id","type","created_at");--> statement-breakpoint
CREATE INDEX "reference_reused_from_media_idx" ON "ai-thing_reference" USING btree ("reused_from_media_id");--> statement-breakpoint
ALTER TABLE "ai-thing_reference" ADD CONSTRAINT "ai-thing_reference_reused_from_media_id_unique" UNIQUE("reused_from_media_id");