ALTER TABLE "ai-thing_image" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "ai-thing_prompt" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "ai-thing_reference" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE INDEX "image_user_id_idx" ON "ai-thing_image" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prompt_user_id_idx" ON "ai-thing_prompt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_user_id_idx" ON "ai-thing_reference" USING btree ("user_id");