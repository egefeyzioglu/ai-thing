CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "telemetry_span_operation_trgm_idx" ON "telemetry_span" USING gin ("operation" gin_trgm_ops);
