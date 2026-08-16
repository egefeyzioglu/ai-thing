import { auth } from "@clerk/nextjs/server";
import { and, asc, count, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { currentUserCanViewTelemetry } from "src/server/telemetry/auth";
import { getTelemetryDb } from "src/server/telemetry/db";
import { telemetrySpans } from "src/server/telemetry/schema";

const searchParamsSchema = z.object({
  range: z.coerce.number().int().min(60).max(2_592_000).default(1_800),
});

const BUCKET_COUNT = 24;

export async function GET(request: Request) {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await currentUserCanViewTelemetry())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const { range } = parsed.data;
  const cutoff = new Date(Date.now() - range * 1_000);
  const bucketSeconds = Math.max(1, Math.ceil(range / BUCKET_COUNT));
  const timeFilters = gte(telemetrySpans.startedAt, cutoff);
  const rootFilters = and(isNull(telemetrySpans.parentSpanId), timeFilters);
  const isUnexpectedError = sql<number>`case when ${telemetrySpans.outcome} = 'unexpected_error' then 1 else 0 end`;
  const isRoot = sql<boolean>`${telemetrySpans.parentSpanId} is null`;
  const boardFilters = {
    production: rootFilters,
    generation: and(
      timeFilters,
      or(
        ilike(telemetrySpans.operation, "%generat%"),
        ilike(telemetrySpans.operation, "%image%"),
        ilike(telemetrySpans.operation, "%fal%"),
        ilike(telemetrySpans.operation, "%openai%"),
        ilike(telemetrySpans.operation, "%replicate%"),
      ),
    ),
    database: and(
      timeFilters,
      or(
        ilike(telemetrySpans.operation, "%database%"),
        ilike(telemetrySpans.operation, "%postgres%"),
        ilike(telemetrySpans.operation, "%db.%"),
        ilike(telemetrySpans.operation, "%query%"),
        ilike(telemetrySpans.operation, "%insert%"),
        ilike(telemetrySpans.operation, "%select%"),
        ilike(telemetrySpans.operation, "%update%"),
      ),
    ),
    uploads: and(
      timeFilters,
      or(
        ilike(telemetrySpans.operation, "%upload%"),
        ilike(telemetrySpans.operation, "%storage%"),
        ilike(telemetrySpans.operation, "%multipart%"),
        ilike(telemetrySpans.operation, "%file%"),
      ),
    ),
  };
  const aggregate = (
    filters: NonNullable<(typeof boardFilters)[keyof typeof boardFilters]>,
  ) =>
    telemetryDb
      .select({
        errorCount: sql<number>`coalesce(sum(${isUnexpectedError}), 0)::int`,
        p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetrySpans.durationMs}), 0)::float`,
        requestCount: count(),
      })
      .from(telemetrySpans)
      .where(filters);

  try {
    const [services, buckets, operations, overallRows, ...boardRows] =
      await Promise.all([
        telemetryDb
          .select({
            errorCount: sql<number>`sum(${isUnexpectedError})::int`,
            p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetrySpans.durationMs}), 0)::float`,
            requestCount: count(),
            service: telemetrySpans.service,
          })
          .from(telemetrySpans)
          .where(rootFilters)
          .groupBy(telemetrySpans.service)
          .orderBy(sql`count(*) desc`),
        telemetryDb
          .select({
            bucket: sql<number>`floor(extract(epoch from (${telemetrySpans.startedAt} - ${cutoff})) / ${bucketSeconds})::int`,
            errorCount: sql<number>`sum(${isUnexpectedError})::int`,
            p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetrySpans.durationMs}), 0)::float`,
            requestCount: count(),
            operation: telemetrySpans.operation,
            root: isRoot,
          })
          .from(telemetrySpans)
          .where(timeFilters)
          .groupBy(sql`1`, telemetrySpans.operation, isRoot)
          .orderBy(asc(sql`1`)),
        telemetryDb
          .select({
            errorCount: sql<number>`sum(${isUnexpectedError})::int`,
            operation: telemetrySpans.operation,
            p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetrySpans.durationMs}), 0)::float`,
            requestCount: count(),
            root: isRoot,
          })
          .from(telemetrySpans)
          .where(timeFilters)
          .groupBy(telemetrySpans.operation, isRoot)
          .orderBy(sql`count(*) desc`)
          .limit(20),
        telemetryDb
          .select({
            errorCount: sql<number>`sum(${isUnexpectedError})::int`,
            p95Ms: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${telemetrySpans.durationMs}), 0)::float`,
            requestCount: count(),
          })
          .from(telemetrySpans)
          .where(rootFilters),
        ...Object.values(boardFilters).map((filters) => aggregate(filters!)),
      ]);

    const overall = overallRows[0];
    const requestCount = Number(overall?.requestCount ?? 0);
    const errorCount = Number(overall?.errorCount ?? 0);

    return NextResponse.json({
      bucketCount: BUCKET_COUNT,
      buckets: buckets.map((bucket) => ({
        bucket: Number(bucket.bucket),
        errorCount: Number(bucket.errorCount),
        operation: bucket.operation,
        p95Ms: Number(bucket.p95Ms),
        requestCount: Number(bucket.requestCount),
        root: bucket.root,
      })),
      boards: Object.fromEntries(
        Object.keys(boardFilters).map((board, index) => {
          const metric = boardRows[index]?.[0];
          return [
            board,
            {
              errorCount: Number(metric?.errorCount ?? 0),
              p95Ms: Number(metric?.p95Ms ?? 0),
              requestCount: Number(metric?.requestCount ?? 0),
            },
          ];
        }),
      ),
      operations: operations.map((operation) => ({
        errorCount: Number(operation.errorCount),
        operation: operation.operation,
        p95Ms: Number(operation.p95Ms),
        requestCount: Number(operation.requestCount),
        root: operation.root,
      })),
      overall: {
        errorCount,
        errorRate: requestCount === 0 ? 0 : errorCount / requestCount,
        p95Ms: Number(overall?.p95Ms ?? 0),
        requestCount,
        serviceCount: services.length,
      },
      services: services.map((service) => ({
        errorCount: Number(service.errorCount),
        errorRate:
          Number(service.requestCount) === 0
            ? 0
            : Number(service.errorCount) / Number(service.requestCount),
        p95Ms: Number(service.p95Ms),
        requestCount: Number(service.requestCount),
        service: service.service,
      })),
    });
  } catch (error) {
    console.error("[telemetry] Failed to load summary", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Unable to query telemetry database" },
      { status: 500 },
    );
  }
}
