import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "src/env";
import * as schema from "./schema";

type TelemetryClient = ReturnType<typeof postgres>;
type TelemetryDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForTelemetry = globalThis as unknown as {
  telemetryClient: TelemetryClient | undefined;
  telemetryDb: TelemetryDb | undefined;
};

export function getTelemetryDb(): TelemetryDb | null {
  if (!env.TELEMETRY_DATABASE_URL) return null;
  if (globalForTelemetry.telemetryDb) return globalForTelemetry.telemetryDb;

  const client = postgres(env.TELEMETRY_DATABASE_URL, {
    prepare: false,
    // Telemetry is best-effort: fail fast instead of the 30s default so a
    // sick telemetry database cannot stall request-scoped after() work.
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  globalForTelemetry.telemetryClient = client;
  globalForTelemetry.telemetryDb = db;
  return db;
}
