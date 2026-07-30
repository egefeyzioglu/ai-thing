import { type Config } from "drizzle-kit";

import { env } from "src/env";

const url = env.TELEMETRY_DIRECT_URL ?? env.TELEMETRY_DATABASE_URL;
if (!url) {
  throw new Error("TELEMETRY_DIRECT_URL or TELEMETRY_DATABASE_URL is required");
}

export default {
  schema: "./src/server/telemetry/schema.ts",
  out: "./drizzle-telemetry",
  dialect: "postgresql",
  dbCredentials: { url },
  tablesFilter: ["telemetry_*"],
} satisfies Config;
