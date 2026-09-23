import { existsSync, readFileSync } from "node:fs";

export const PROVIDER_KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "ARK_API_KEY"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

/**
 * Minimal `.env` reader: KEY=value / KEY="value" / KEY='value', `#` comments.
 * Existing process.env values win. Only the listed keys are imported.
 */
export function loadEnvFile(path: string, keys: readonly string[] = PROVIDER_KEYS): string[] {
  if (!existsSync(path)) return [];
  const wanted = new Set(keys);
  const loaded: string[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!wanted.has(key) || process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/s.exec(value);
    if (quoted) value = quoted[2]!;
    if (!value) continue;
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
