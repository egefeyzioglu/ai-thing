import { timingSafeEqual } from "node:crypto";

import { and, asc, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "src/env";
import { db } from "src/server/db";
import { generationUsage, media } from "src/server/db/schema";
import { createWideEvent } from "src/server/observability/event";

export const dynamic = "force-dynamic";

const MINUTE_MS = 60_000;
const MAX_REPORTED_IDS = 20;

function hasValidSecret(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(env.CRON_SECRET);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function GET(request: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Generation monitor is not configured" },
      { status: 503 },
    );
  }
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const event = createWideEvent("monitor.stuck_generations", { requestId });
  const now = new Date();
  const pendingCutoff = new Date(now.getTime() - 5 * MINUTE_MS);
  const imageCutoff = new Date(now.getTime() - 10 * MINUTE_MS);
  const videoCutoff = new Date(now.getTime() - 30 * MINUTE_MS);
  const usageCutoff = new Date(now.getTime() - 20 * MINUTE_MS);

  try {
    const [pendingRows, runningImages, runningVideos, reservedRows] =
      await Promise.all([
        db
          .select({ id: media.id, updatedAt: media.updatedAt })
          .from(media)
          .where(
            and(
              eq(media.status, "pending"),
              lt(media.updatedAt, pendingCutoff),
            ),
          )
          .orderBy(asc(media.updatedAt))
          .limit(MAX_REPORTED_IDS + 1),
        db
          .select({
            id: media.id,
            updatedAt: media.updatedAt,
          })
          .from(media)
          .where(
            and(
              eq(media.status, "running"),
              eq(media.type, "image"),
              lt(media.updatedAt, imageCutoff),
            ),
          )
          .orderBy(asc(media.updatedAt))
          .limit(MAX_REPORTED_IDS + 1),
        db
          .select({
            id: media.id,
            updatedAt: media.updatedAt,
          })
          .from(media)
          .where(
            and(
              eq(media.status, "running"),
              eq(media.type, "video"),
              lt(media.updatedAt, videoCutoff),
            ),
          )
          .orderBy(asc(media.updatedAt))
          .limit(MAX_REPORTED_IDS + 1),
        db
          .select({ id: generationUsage.id, mediaId: generationUsage.mediaId })
          .from(generationUsage)
          .where(
            and(
              eq(generationUsage.status, "reserved"),
              lt(generationUsage.updatedAt, usageCutoff),
            ),
          )
          .orderBy(asc(generationUsage.updatedAt))
          .limit(MAX_REPORTED_IDS + 1),
      ]);
    const reportedCounts = {
      pendingTooLong: pendingRows.length,
      reservedUsageTooLong: reservedRows.length,
      runningImagesTooLong: runningImages.length,
      runningVideosTooLong: runningVideos.length,
    };
    const reportedTotal = Object.values(reportedCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    const countsAreLowerBounds =
      pendingRows.length > MAX_REPORTED_IDS ||
      reservedRows.length > MAX_REPORTED_IDS ||
      runningImages.length > MAX_REPORTED_IDS ||
      runningVideos.length > MAX_REPORTED_IDS;

    event.set({
      countsAreLowerBounds,
      pendingMediaIds: pendingRows
        .slice(0, MAX_REPORTED_IDS)
        .map((row) => row.id),
      reservedUsageIds: reservedRows
        .slice(0, MAX_REPORTED_IDS)
        .map((row) => row.id),
      runningImageIds: runningImages
        .slice(0, MAX_REPORTED_IDS)
        .map((row) => row.id),
      runningVideoIds: runningVideos
        .slice(0, MAX_REPORTED_IDS)
        .map((row) => row.id),
      reportedCounts,
      reportedTotal,
    });

    if (reportedTotal > 0) {
      event.fail(new Error("Stuck generation state detected"), "state_scan");
    }

    return NextResponse.json(
      {
        countsAreLowerBounds,
        reportedCounts,
        reportedTotal,
        status: reportedTotal > 0 ? "degraded" : "ok",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    event.fail(error, "state_scan");
    return NextResponse.json(
      { error: "Generation monitor failed", requestId },
      { status: 500 },
    );
  } finally {
    await event.emit();
  }
}
