import "server-only";

import { lt } from "drizzle-orm";

import { getTelemetryDb } from "./db";
import { telemetrySpans } from "./schema";

export const TELEMETRY_RETENTION_DAYS = 30;

export async function deleteExpiredTelemetry(): Promise<number | null> {
  const telemetryDb = getTelemetryDb();
  if (!telemetryDb) return null;

  const cutoff = new Date(
    Date.now() - TELEMETRY_RETENTION_DAYS * 24 * 60 * 60_000,
  );
  const deleted = await telemetryDb
    .delete(telemetrySpans)
    .where(lt(telemetrySpans.startedAt, cutoff))
    .returning({ eventId: telemetrySpans.eventId });

  return deleted.length;
}
