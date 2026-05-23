CREATE TABLE "ai-thing_generation_cost_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_id" text,
	"provider" text NOT NULL,
	"provider_request_id" text,
	"model" text NOT NULL,
	"provider_model" text,
	"operation" text NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"pricing_version" text NOT NULL,
	"cost_usd_micros" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"input_text_tokens" integer,
	"input_image_tokens" integer,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_text_tokens" integer,
	"output_image_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"total_tokens" integer,
	"output_image_count" integer,
	"fallback_reason" text,
	"usage_raw" json,
	"cost_calculation_raw" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" ADD CONSTRAINT "ai-thing_generation_cost_event_image_id_ai-thing_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ai-thing_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_cost_event_user_created_idx" ON "ai-thing_generation_cost_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_cost_event_image_idx" ON "ai-thing_generation_cost_event" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "generation_cost_event_provider_created_idx" ON "ai-thing_generation_cost_event" USING btree ("provider","created_at");