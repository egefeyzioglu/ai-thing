import { type Config } from "drizzle-kit";

import { env } from "src/env";

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Use DIRECT_URL for migrations when set (Supabase: port 5432).
    // Falls back to DATABASE_URL for local Postgres.
    url: env.DIRECT_URL ?? env.DATABASE_URL,
  },
  tablesFilter: ["ai-thing_*"],
} satisfies Config;
