import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  HoneycombQueryError,
  runHoneycombQuery,
} from "src/server/observability/honeycomb-query";

const searchParamsSchema = z.object({
  preset: z.enum(["all", "errors", "slow"]).default("errors"),
  range: z.coerce.number().int().min(60).max(604_800).default(1_800),
});

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function GET(request: Request) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = searchParamsSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { preset, range } = parsed.data;
  const filters = [
    { column: "trace.trace_id", op: "exists" },
    { column: "trace.parent_id", op: "does-not-exist" },
    ...(preset === "errors"
      ? [{ column: "outcome", op: "=", value: "unexpected_error" }]
      : []),
    ...(preset === "slow"
      ? [{ column: "duration_ms", op: ">=", value: 1_000 }]
      : []),
  ];

  try {
    const result = await runHoneycombQuery({
      breakdowns: [
        "timestamp",
        "trace.trace_id",
        "name",
        "operation",
        "outcome",
        "duration_ms",
        "service",
        "telemetrySource",
        "error.name",
        "error.message",
        "release",
        "userId",
      ],
      filters,
      limit: 100,
      orders: [{ column: "timestamp", order: "descending" }],
      time_range: range,
    });

    return NextResponse.json({
      queryUrl: result.queryUrl,
      traces: result.rows.map((row) => {
        const traceId = stringValue(row, "trace.trace_id") ?? "";
        return {
          id: traceId,
          shortId: traceId.slice(0, 8),
          operation:
            stringValue(row, "operation") ??
            stringValue(row, "name") ??
            "unknown operation",
          outcome: stringValue(row, "outcome") ?? "success",
          durationMs: numberValue(row, "duration_ms"),
          service: stringValue(row, "service") ?? "ai-thing",
          source: stringValue(row, "telemetrySource") ?? "server",
          errorName: stringValue(row, "error.name"),
          errorMessage: stringValue(row, "error.message"),
          release: stringValue(row, "release"),
          userId: stringValue(row, "userId"),
          startedAt: stringValue(row, "timestamp"),
        };
      }),
    });
  } catch (error) {
    const status = error instanceof HoneycombQueryError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Telemetry query failed";
    return NextResponse.json({ error: message }, { status });
  }
}
