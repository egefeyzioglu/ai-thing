/**
 * Talks to the image MCP server directly over stdio (no agent involved).
 *   npx tsx scripts/imagegen-test.ts [model] ["prompt"] [reference-image ...]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile, PROVIDER_KEYS } from "../env.js";

const harness = dirname(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(join(harness, "..", ".env"));

const model = process.argv[2] ?? "gemini-2.5-flash-image";
const prompt = process.argv[3] ?? "a red circle on a white background";
const refs = process.argv.slice(4);
const outDir = process.env.AITHING_OUTPUT_DIR ?? join(harness, "workspace", "generated");

const env: Record<string, string> = { PATH: process.env.PATH ?? "", AITHING_OUTPUT_DIR: outDir };
for (const k of PROVIDER_KEYS) if (process.env[k]) env[k] = process.env[k]!;

const transport = new StdioClientTransport({
  command: join(harness, "node_modules/.bin/tsx"),
  args: [join(harness, "mcp/image-tools.ts")],
  env,
  stderr: "inherit",
});
const client = new Client({ name: "imagegen-test", version: "0.0.1" });
await client.connect(transport);

const list = await client.callTool({ name: "list_image_models", arguments: {} });
console.log((list.content as any[]).map((c) => c.text).join("\n"), "\n");

const t0 = Date.now();
const res = await client.callTool({
  name: "generate_image",
  arguments: { prompt, model, ...(refs.length && { reference_images: refs }) },
});
for (const c of res.content as any[]) {
  if (c.type === "text") console.log(c.text);
  else if (c.type === "image") console.log(`[image preview ${c.mimeType}, ${Math.round(c.data.length / 1024)} KB base64]`);
}
console.log(res.isError ? "FAILED" : "OK", `${((Date.now() - t0) / 1000).toFixed(1)}s`);
await client.close();
process.exit(res.isError ? 1 : 0);
