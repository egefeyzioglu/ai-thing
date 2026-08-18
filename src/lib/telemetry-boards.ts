export const TELEMETRY_BOARD_TERMS = {
  production: [],
  generation: ["generat", "image", "fal", "openai", "replicate"],
  database: [
    "database",
    "postgres",
    "db.",
    "query",
    "insert",
    "select",
    "update",
  ],
  uploads: ["upload", "storage", "multipart", "file"],
} as const;

export type TelemetryBoardId = keyof typeof TELEMETRY_BOARD_TERMS;
