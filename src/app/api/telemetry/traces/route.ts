import { auth } from "@clerk/nextjs/server";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getTelemetryDb } from "src/server/telemetry/db";
import { telemetrySpans } from "src/server/telemetry/schema";

const searchParamsSchema = z.object({
  preset: z.enum(["all", "errors", "slow"]).default("errors"),
  range: z.coerce.number().int().min(60).max(2_592_000).default(1_800),
});

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

  const telemetryDb = getTelemetryDb();
  if (!telemetryDb) {
    return NextResponse.json(
      { error: "TELEMETRY_DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const { preset, range } = parsed.data;
  const cutoff = new Date(Date.now() - range * 1_000);
  const filters = [
    isNotNull(telemetrySpans.traceId),
    isNull(telemetrySpans.parentSpanId),
    gte(telemetrySpans.startedAt, cutoff),
    ...(preset === "errors"
      ? [eq(telemetrySpans.outcome, "unexpected_error" as const)]
      : []),
    ...(preset === "slow" ? [gte(telemetrySpans.durationMs, 1_000)] : []),
  ];

  try {
    const roots = await telemetryDb
      .select()
      .from(telemetrySpans)
      .where(and(...filters))
      .orderBy(desc(telemetrySpans.startedAt))
      .limit(100);

    const traceIds = roots.flatMap((span) =>
      span.traceId ? [span.traceId] : [],
    );
    const spanCounts =
      traceIds.length === 0
        ? []
        : await telemetryDb
            .select({
              traceId: telemetrySpans.traceId,
              count: count(),
            })
            .from(telemetrySpans)
            .where(inArray(telemetrySpans.traceId, traceIds))
            .groupBy(telemetrySpans.traceId);
    const countByTraceId = new Map(
      spanCounts.map((result) => [result.traceId, result.count]),
    );

    return NextResponse.json({
      traces: roots.map((span) => ({
        id: span.traceId,
        shortId: span.traceId?.slice(0, 8) ?? "",
        operation: span.operation,
        outcome: span.outcome,
        durationMs: span.durationMs,
        service: span.service,
        source: span.source,
        errorName: span.error?.name ?? null,
        errorMessage: span.error?.message ?? null,
        release: span.release,
        userId: span.userId,
        startedAt: span.startedAt.toISOString(),
        spanCount: countByTraceId.get(span.traceId) ?? 1,
      })),
    });
  } catch (error) {
    console.error("[telemetry] Failed to list traces", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to query telemetry database" },
      { status: 500 },
    );
  }
}
