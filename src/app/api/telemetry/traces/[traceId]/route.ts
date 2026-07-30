import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUserCanViewTelemetry } from "src/server/telemetry/auth";
import { getTelemetryDb } from "src/server/telemetry/db";
import { telemetrySpans } from "src/server/telemetry/schema";

const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const SPAN_LIMIT = 500;

export async function GET(
  _request: Request,
  context: { params: Promise<{ traceId: string }> },
) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await currentUserCanViewTelemetry())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsedTraceId = traceIdSchema.safeParse((await context.params).traceId);
  if (!parsedTraceId.success) {
    return NextResponse.json({ error: "Invalid trace ID" }, { status: 400 });
  }

  const telemetryDb = getTelemetryDb();
  if (!telemetryDb) {
    return NextResponse.json(
      { error: "TELEMETRY_DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  try {
    const results = await telemetryDb
      .select()
      .from(telemetrySpans)
      .where(
        and(
          eq(telemetrySpans.traceId, parsedTraceId.data),
          gte(telemetrySpans.startedAt, new Date(Date.now() - RETENTION_MS)),
        ),
      )
      .orderBy(asc(telemetrySpans.startedAt))
      .limit(SPAN_LIMIT + 1);
    const truncated = results.length > SPAN_LIMIT;

    return NextResponse.json({
      truncated,
      spans: results.slice(0, SPAN_LIMIT).map((span) => ({
        id: span.spanId ?? span.eventId,
        parentId: span.parentSpanId,
        name: span.operation,
        operation: span.operation,
        outcome: span.outcome,
        durationMs: span.durationMs,
        service: span.service,
        source: span.source,
        errorName: span.error?.name ?? null,
        errorMessage: span.error?.message ?? null,
        errorStack: span.error?.stack ?? null,
        startedAt: span.startedAt.toISOString(),
        attributes: span.attributes,
      })),
    });
  } catch (error) {
    console.error("[telemetry] Failed to load trace", {
      traceId: parsedTraceId.data,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to query telemetry database" },
      { status: 500 },
    );
  }
}
