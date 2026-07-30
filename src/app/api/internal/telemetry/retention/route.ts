import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "src/env";
import {
  deleteExpiredTelemetry,
  TELEMETRY_RETENTION_DAYS,
} from "src/server/telemetry/retention";

export const dynamic = "force-dynamic";

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
  if (!env.CRON_SECRET || !env.TELEMETRY_DATABASE_URL) {
    return NextResponse.json(
      { error: "Telemetry retention is not configured" },
      { status: 503 },
    );
  }
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await deleteExpiredTelemetry();
    return NextResponse.json({
      deleted,
      retentionDays: TELEMETRY_RETENTION_DAYS,
    });
  } catch (error) {
    console.error("[telemetry] Retention cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Telemetry retention cleanup failed" },
      { status: 500 },
    );
  }
}
