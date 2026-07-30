import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  HoneycombQueryError,
  runHoneycombQuery,
} from "src/server/observability/honeycomb-query";

const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedTraceId = traceIdSchema.safeParse((await context.params).traceId);
  if (!parsedTraceId.success) {
    return NextResponse.json({ error: "Invalid trace ID" }, { status: 400 });
  }

  try {
    const result = await runHoneycombQuery({
      breakdowns: [
        "timestamp",
        "trace.span_id",
        "trace.parent_id",
        "name",
        "operation",
        "outcome",
        "duration_ms",
        "service",
        "telemetrySource",
        "error.name",
        "error.message",
        "error.stack",
      ],
      filters: [
        {
          column: "trace.trace_id",
          op: "=",
          value: parsedTraceId.data,
        },
      ],
      limit: 500,
      orders: [{ column: "timestamp", order: "ascending" }],
      time_range: 604_800,
    });

    return NextResponse.json({
      queryUrl: result.queryUrl,
      spans: result.rows.map((row) => ({
        id: stringValue(row, "trace.span_id") ?? crypto.randomUUID(),
        parentId: stringValue(row, "trace.parent_id"),
        name:
          stringValue(row, "name") ??
          stringValue(row, "operation") ??
          "unknown span",
        operation: stringValue(row, "operation"),
        outcome: stringValue(row, "outcome") ?? "success",
        durationMs: numberValue(row, "duration_ms"),
        service: stringValue(row, "service") ?? "ai-thing",
        source: stringValue(row, "telemetrySource") ?? "server",
        errorName: stringValue(row, "error.name"),
        errorMessage: stringValue(row, "error.message"),
        errorStack: stringValue(row, "error.stack"),
        startedAt: stringValue(row, "timestamp"),
      })),
    });
  } catch (error) {
    const status = error instanceof HoneycombQueryError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Telemetry query failed";
    return NextResponse.json({ error: message }, { status });
  }
}
