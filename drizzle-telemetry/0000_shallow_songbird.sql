CREATE TABLE "telemetry_span" (
	"event_id" text PRIMARY KEY NOT NULL,
	"trace_id" text,
	"span_id" text,
	"parent_span_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"operation" text NOT NULL,
	"outcome" text NOT NULL,
	"service" text NOT NULL,
	"source" text NOT NULL,
	"environment" text NOT NULL,
	"release" text,
	"user_id" text,
	"error" jsonb,
	"attributes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telemetry_span_started_at_idx" ON "telemetry_span" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "telemetry_span_trace_started_idx" ON "telemetry_span" USING btree ("trace_id","started_at");--> statement-breakpoint
CREATE INDEX "telemetry_span_unexpected_error_idx" ON "telemetry_span" USING btree ("started_at" DESC NULLS LAST) WHERE "telemetry_span"."outcome" = 'unexpected_error';