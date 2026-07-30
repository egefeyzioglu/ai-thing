import "server-only";

import { sql } from "drizzle-orm";

import { getTelemetryDb } from "./db";
import { telemetrySpans } from "./schema";

export const TELEMETRY_RETENTION_DAYS = 30;

export async function deleteExpiredTelemetry(): Promise<number | null> {
  const telemetryDb = getTelemetryDb();
  if (!telemetryDb) return null;

  const cutoff = new Date(
    Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60_000,
  );
  const deleted = await telemetryDb.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM ${telemetrySpans}
      WHERE ${telemetrySpans.startedAt} < ${cutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS count FROM deleted
  `);

  return deleted[0]?.count ?? 0;
}
