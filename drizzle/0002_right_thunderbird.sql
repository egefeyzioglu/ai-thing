ALTER TABLE "ai-thing_image" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-thing_image" ALTER COLUMN "key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-thing_image" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai-thing_image" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "ai-thing_image" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Backfill: existing rows already have a uploaded image, mark them succeeded.
UPDATE "ai-thing_image" SET "status" = 'succeeded' WHERE "url" IS NOT NULL;