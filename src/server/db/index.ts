import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "src/env";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof postgres> | undefined;
};

export const client =
  globalForDb.client ??
  postgres(env.DATABASE_URL, {
    // Supabase's pooler (port 6543) requires prepared statements off.
    // Harmless for local Postgres / direct connections.
    prepare: false,
  });
if (env.NODE_ENV !== "production") globalForDb.client = client;

export const db = drizzle(client, { schema });
