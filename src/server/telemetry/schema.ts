import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type {
  EventOutcome,
  JsonValue,
  WideEvent,
} from "src/server/observability/event";

export const telemetrySpans = pgTable(
  "telemetry_span",
  {
    eventId: text("event_id").primaryKey(),
    traceId: text("trace_id"),
    spanId: text("span_id"),
    parentSpanId: text("parent_span_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    operation: text("operation").notNull(),
    outcome: text("outcome").notNull().$type<EventOutcome>(),
    service: text("service").notNull(),
    source: text("source").notNull().$type<WideEvent["telemetrySource"]>(),
    environment: text("environment").notNull(),
    release: text("release"),
    userId: text("user_id"),
    error: jsonb("error").$type<WideEvent["error"]>(),
    attributes: jsonb("attributes")
      .notNull()
      .$type<Record<string, JsonValue>>(),
  },
  (table) => [
    index("telemetry_span_started_at_idx").on(table.startedAt.desc()),
    index("telemetry_span_trace_started_idx").on(
      table.traceId,
      table.startedAt,
    ),
    index("telemetry_span_unexpected_error_idx")
      .on(table.startedAt.desc())
      .where(sql`${table.outcome} = 'unexpected_error'`),
  ],
);
