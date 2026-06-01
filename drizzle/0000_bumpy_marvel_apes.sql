CREATE TABLE "ai-thing_generation_cost_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_id" text,
	"usage_id" text,
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
CREATE TABLE "ai-thing_generation_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_id" text,
	"model" text NOT NULL,
	"resolution" text,
	"aspect_ratio" text,
	"credits" integer NOT NULL,
	"usage_type" text DEFAULT 'image_generation' NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_image" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"prompt_id" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"url" text,
	"key" text,
	"mime_type" text DEFAULT 'image/png' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_project" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"project_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference_ids" json,
	"resolution" text,
	"aspect_ratio" text,
	"quality" text,
	"background" text,
	"negative_prompt" text,
	"seed" text,
	"thinking" text
);
--> statement-breakpoint
CREATE TABLE "ai-thing_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"url" text,
	"mime_type" text DEFAULT 'image/png' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reused_from_image_id" text,
	CONSTRAINT "ai-thing_reference_reused_from_image_id_unique" UNIQUE("reused_from_image_id")
);
--> statement-breakpoint
CREATE TABLE "ai-thing_workshop_message" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"model" text,
	"content" text NOT NULL,
	"reference_ids" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_workshop_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" ADD CONSTRAINT "ai-thing_generation_cost_event_image_id_ai-thing_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ai-thing_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_generation_cost_event" ADD CONSTRAINT "ai-thing_generation_cost_event_usage_id_ai-thing_generation_usage_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."ai-thing_generation_usage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_generation_usage" ADD CONSTRAINT "ai-thing_generation_usage_image_id_ai-thing_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ai-thing_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_image" ADD CONSTRAINT "ai-thing_image_prompt_id_ai-thing_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai-thing_prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_prompt" ADD CONSTRAINT "ai-thing_prompt_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_reference" ADD CONSTRAINT "ai-thing_reference_reused_from_image_id_ai-thing_image_id_fk" FOREIGN KEY ("reused_from_image_id") REFERENCES "public"."ai-thing_image"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ADD CONSTRAINT "ai-thing_workshop_message_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_message" ADD CONSTRAINT "ai-thing_workshop_message_thread_id_ai-thing_workshop_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."ai-thing_workshop_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai-thing_workshop_thread" ADD CONSTRAINT "ai-thing_workshop_thread_project_id_ai-thing_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai-thing_project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_cost_event_user_created_idx" ON "ai-thing_generation_cost_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_cost_event_image_idx" ON "ai-thing_generation_cost_event" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "generation_cost_event_usage_idx" ON "ai-thing_generation_cost_event" USING btree ("usage_id");--> statement-breakpoint
CREATE INDEX "generation_cost_event_provider_created_idx" ON "ai-thing_generation_cost_event" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "generation_usage_user_created_idx" ON "ai-thing_generation_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_usage_user_status_created_idx" ON "ai-thing_generation_usage" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "generation_usage_image_idx" ON "ai-thing_generation_usage" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "image_created_at_idx" ON "ai-thing_image" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "image_prompt_id_idx" ON "ai-thing_image" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "image_user_id_idx" ON "ai-thing_image" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_user_id_idx" ON "ai-thing_project" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_user_name_unique" ON "ai-thing_project" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "project_user_default_idx" ON "ai-thing_project" USING btree ("user_id","is_default");--> statement-breakpoint
CREATE INDEX "prompt_created_at_idx" ON "ai-thing_prompt" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prompt_user_id_idx" ON "ai-thing_prompt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prompt_project_created_at_idx" ON "ai-thing_prompt" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "reference_user_id_idx" ON "ai-thing_reference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reference_reused_from_idx" ON "ai-thing_reference" USING btree ("reused_from_image_id");--> statement-breakpoint
CREATE INDEX "workshop_message_thread_created_idx" ON "ai-thing_workshop_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "workshop_message_user_project_created_idx" ON "ai-thing_workshop_message" USING btree ("user_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "workshop_message_project_created_idx" ON "ai-thing_workshop_message" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "workshop_thread_user_project_updated_idx" ON "ai-thing_workshop_thread" USING btree ("user_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "workshop_thread_project_updated_idx" ON "ai-thing_workshop_thread" USING btree ("project_id","updated_at");