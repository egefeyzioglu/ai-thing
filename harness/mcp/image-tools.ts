/**
 * aithing-images — a stdio MCP server exposing image generation tools.
 *
 * Spawned per ACP session by server.ts. Generated images are written as
 * files into AITHING_OUTPUT_DIR (the thread's shared workspace folder), and
 * the tools return file paths plus a downscaled preview so the agent can
 * look at what it made without flooding its context.
 *
 * stdout is the MCP transport: log to stderr only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

const OUTPUT_DIR = resolve(process.env.AITHING_OUTPUT_DIR ?? join(process.cwd(), "generated"));
const THREAD_CWD = dirname(OUTPUT_DIR);
const log = (...a: unknown[]) => console.error("[aithing-images]", ...a);

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

type Provider = "openai" | "gemini" | "modelark";
type Resolution = "1K" | "2K" | "4K";

type ModelSpec = {
  provider: Provider;
  key: "OPENAI_API_KEY" | "GEMINI_API_KEY" | "ARK_API_KEY";
  resolutions: Resolution[];
  aspectRatios: string[];
  references: boolean;
  note: string;
};

const MODELS: Record<string, ModelSpec> = {
  "gemini-2.5-flash-image": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K"],
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    references: true,
    note: "Fast, cheap default. Good for drafts, iteration, and edits with reference images.",
  },
  "gemini-3.1-flash-image-preview": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    references: true,
    note: "Newer Gemini flash image model with higher resolutions.",
  },
  "gemini-3-pro-image-preview": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    references: true,
    note: "Highest-quality Gemini option; slower. Strong at text and complex compositions.",
  },
  "gpt-image-2": {
    provider: "openai",
    key: "OPENAI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: ["1:1", "3:2", "2:3"],
    references: true,
    note: "OpenAI image model. Excellent prompt adherence and typography; supports edits with references.",
  },
  "dola-seedream-5-0-lite": {
    provider: "modelark",
    key: "ARK_API_KEY",
    resolutions: ["2K", "4K"],
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    references: true,
    note: "BytePlus Seedream 5.0 Lite. Photoreal, high resolution, good value.",
  },
  "dola-seedream-5-0-pro": {
    provider: "modelark",
    key: "ARK_API_KEY",
    resolutions: ["1K", "2K"],
    aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    references: true,
    note: "BytePlus Seedream 5.0 Pro. Best Seedream quality; slower.",
  },
};
const DEFAULT_MODEL = "gemini-2.5-flash-image";

const SEEDREAM_MODEL_ID: Record<string, string> = {
  "dola-seedream-5-0-lite": "seedream-5-0-260128",
  "dola-seedream-5-0-pro": "dola-seedream-5-0-pro-260628",
};
const SEEDREAM_SIZES: Record<string, Partial<Record<Resolution, Record<string, string>>>> = {
  "dola-seedream-5-0-lite": {
    "2K": { "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2848x1600", "9:16": "1600x2848" },
    "4K": { "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "16:9": "5504x3040", "9:16": "3040x5504" },
  },
  "dola-seedream-5-0-pro": {
    "1K": { "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800", "9:16": "800x1424" },
    "2K": { "1:1": "2048x2048", "4:3": "2368x1776", "3:4": "1776x2368", "16:9": "2816x1584", "9:16": "1584x2816" },
  },
};

function hasKey(spec: ModelSpec) {
  return Boolean(process.env[spec.key]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Generated = { bytes: Buffer; mimeType: string; providerRequestId: string | null; providerModel: string };

class ToolError extends Error {}

function resolveInput(path: string): string {
  const abs = isAbsolute(path) ? path : resolve(THREAD_CWD, path);
  if (!existsSync(abs)) throw new ToolError(`file not found: ${path} (resolved to ${abs})`);
  return abs;
}

function mimeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}

function loadRefs(paths: string[] | undefined) {
  return (paths ?? []).map((p) => {
    const abs = resolveInput(p);
    return { path: abs, bytes: readFileSync(abs), mimeType: mimeFor(abs) };
  });
}

function ratioValue(ar: string): number {
  const [w, h] = ar.split(":").map(Number);
  return w! / h!;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 5)
      .join("-") || "image"
  );
}

function uniquePath(dir: string, base: string, ext: string): string {
  let candidate = join(dir, `${base}${ext}`);
  for (let i = 2; existsSync(candidate); i++) candidate = join(dir, `${base}-${i}${ext}`);
  return candidate;
}

async function providerFetch(label: string, url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new ToolError(`${label} error (${res.status}): ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ToolError(`${label} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function stripDataUrl(b64: string): string {
  return /^data:[^;]+;base64,(.+)$/s.exec(b64)?.[1] ?? b64;
}

async function preview(bytes: Buffer, maxSide: number) {
  const img = sharp(bytes);
  const meta = await img.metadata();
  // JPEG previews: ~10x smaller than PNG for photographic output, which matters
  // because this goes into the agent's context and the persisted event log.
  const out = await img
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { data: out.toString("base64"), mimeType: "image/jpeg" as const, width: meta.width ?? 0, height: meta.height ?? 0 };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

type GenArgs = {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: Resolution;
  refs: { path: string; bytes: Buffer; mimeType: string }[];
};

async function genOpenAI(a: GenArgs): Promise<Generated> {
  const modelId = "gpt-image-2-2026-04-21";
  const r = ratioValue(a.aspectRatio);
  const sq = { "1K": 1024, "2K": 2048, "4K": 4096 }[a.resolution];
  const lg = { "1K": 1536, "2K": 3072, "4K": 6144 }[a.resolution];
  const size = r > 1 ? `${lg}x${sq}` : r < 1 ? `${sq}x${lg}` : `${sq}x${sq}`;
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  let data: any;
  if (a.refs.length) {
    const form = new FormData();
    form.set("model", modelId);
    form.set("prompt", a.prompt);
    form.set("size", size);
    form.set("output_format", "png");
    for (const ref of a.refs) form.append("image[]", new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }), basename(ref.path));
    data = await providerFetch("OpenAI Images (edits)", "https://api.openai.com/v1/images/edits", { method: "POST", headers, body: form }, 300_000);
  } else {
    data = await providerFetch(
      "OpenAI Images",
      "https://api.openai.com/v1/images/generations",
      { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ model: modelId, prompt: a.prompt, size, output_format: "png" }) },
      300_000,
    );
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ToolError("OpenAI response did not contain an image");
  return { bytes: Buffer.from(b64, "base64"), mimeType: "image/png", providerRequestId: data.id ?? null, providerModel: data.model ?? modelId };
}

async function genGemini(a: GenArgs): Promise<Generated> {
  const parts: unknown[] = a.refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.bytes.toString("base64") } }));
  parts.push({ text: a.prompt });
  const imageConfig: Record<string, string> = { aspectRatio: a.aspectRatio };
  if (a.model !== "gemini-2.5-flash-image") imageConfig.imageSize = a.resolution;
  const data = await providerFetch(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig } }),
    },
    300_000,
  );
  const inline = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.inlineData ?? p.inline_data).find((d: any) => d?.data);
  if (!inline) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
    throw new ToolError(`Gemini response did not contain an image${reason ? ` (${reason})` : ""}`);
  }
  let bytes = Buffer.from(inline.data, "base64");
  const mime = inline.mimeType ?? inline.mime_type ?? "image/png";
  if (mime !== "image/png") bytes = await sharp(bytes).png().toBuffer();
  return { bytes, mimeType: "image/png", providerRequestId: data.responseId ?? null, providerModel: data.modelVersion ?? a.model };
}

async function genSeedream(a: GenArgs): Promise<Generated> {
  const size = SEEDREAM_SIZES[a.model]?.[a.resolution]?.[a.aspectRatio];
  if (!size) throw new ToolError(`Unsupported resolution/aspect ratio for ${a.model}: ${a.resolution}/${a.aspectRatio}`);
  const urls = a.refs.map((r) => `data:${r.mimeType};base64,${r.bytes.toString("base64")}`);
  const image = urls.length === 1 ? urls[0] : urls.length > 1 ? urls : undefined;
  const data = await providerFetch(
    "ModelArk Seedream",
    "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ARK_API_KEY}` },
      body: JSON.stringify({ model: SEEDREAM_MODEL_ID[a.model], prompt: a.prompt, ...(image && { image }), size, output_format: "png", response_format: "b64_json", watermark: false }),
    },
    300_000,
  );
  const err = data?.error ?? data?.data?.[0]?.error;
  if (err) throw new ToolError(`ModelArk Seedream error (${err.code ?? "image_failed"}): ${err.message ?? "unknown"}`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ToolError("Seedream response did not contain an image");
  return { bytes: Buffer.from(stripDataUrl(b64), "base64"), mimeType: "image/png", providerRequestId: data.id ?? null, providerModel: data.model ?? SEEDREAM_MODEL_ID[a.model]! };
}

const GENERATORS: Record<Provider, (a: GenArgs) => Promise<Generated>> = { openai: genOpenAI, gemini: genGemini, modelark: genSeedream };

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "aithing-images", version: "0.0.1" });

const errorResult = (message: string) => ({ isError: true as const, content: [{ type: "text" as const, text: message }] });

server.registerTool(
  "list_image_models",
  {
    description: "List the available image generation models, which ones are configured, and what they support.",
    inputSchema: {},
  },
  async () => {
    const lines = [
      "model | provider | available | resolutions | aspect ratios | references | notes",
      ...Object.entries(MODELS).map(
        ([id, m]) =>
          `${id}${id === DEFAULT_MODEL ? " (default)" : ""} | ${m.provider} | ${hasKey(m) ? "yes" : `no (${m.key} missing)`} | ${m.resolutions.join("/")} | ${m.aspectRatios.join(" ")} | ${m.references ? "yes" : "no"} | ${m.note}`,
      ),
      "",
      `Images are written to ${OUTPUT_DIR}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "generate_image",
  {
    description:
      "Generate an image from a prompt (optionally guided by reference images) and save it as a PNG in the thread's generated/ folder. Returns the saved path and a small preview of the result.",
    inputSchema: {
      prompt: z.string().min(1).describe("Detailed description of the image to create."),
      model: z.string().optional().describe(`Model id (see list_image_models). Default ${DEFAULT_MODEL}.`),
      aspect_ratio: z.string().optional().describe('e.g. "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3". Default "1:1".'),
      resolution: z.enum(["1K", "2K", "4K"]).optional().describe("Default: the model's lowest supported resolution."),
      reference_images: z.array(z.string()).optional().describe("Paths (absolute or relative to the thread folder) of PNG/JPEG/WebP images to guide or edit."),
      filename: z.string().optional().describe("Output basename without extension. Default: derived from the prompt."),
    },
  },
  async (input) => {
    try {
      const model = input.model ?? DEFAULT_MODEL;
      const spec = MODELS[model];
      if (!spec) return errorResult(`Unknown model "${model}". Known: ${Object.keys(MODELS).join(", ")}`);
      if (!hasKey(spec)) return errorResult(`${model} is not available: ${spec.key} is not configured.`);
      const aspectRatio = input.aspect_ratio ?? "1:1";
      if (!spec.aspectRatios.includes(aspectRatio)) return errorResult(`${model} does not support aspect ratio ${aspectRatio}. Supported: ${spec.aspectRatios.join(", ")}`);
      const resolution = input.resolution ?? spec.resolutions[0]!;
      if (!spec.resolutions.includes(resolution)) return errorResult(`${model} does not support ${resolution}. Supported: ${spec.resolutions.join(", ")}`);
      const refs = loadRefs(input.reference_images);
      if (refs.length && !spec.references) return errorResult(`${model} does not accept reference images.`);

      log(`generate ${model} ${aspectRatio} ${resolution} refs=${refs.length}`);
      const t0 = Date.now();
      const generated = await GENERATORS[spec.provider]({ model, prompt: input.prompt, aspectRatio, resolution, refs });

      mkdirSync(OUTPUT_DIR, { recursive: true });
      const base = (input.filename?.trim() ? slugify(input.filename) : slugify(input.prompt) + "-" + Date.now().toString(36).slice(-5));
      const pngPath = uniquePath(OUTPUT_DIR, base, ".png");
      writeFileSync(pngPath, generated.bytes);
      const p = await preview(generated.bytes, 768);
      writeFileSync(pngPath.replace(/\.png$/, ".json"), JSON.stringify({
        prompt: input.prompt,
        model,
        aspect_ratio: aspectRatio,
        resolution,
        reference_images: refs.map((r) => r.path),
        provider: spec.provider,
        providerModel: generated.providerModel,
        providerRequestId: generated.providerRequestId,
        width: p.width,
        height: p.height,
        durationMs: Date.now() - t0,
        createdAt: new Date().toISOString(),
      }, null, 2));
      log(`saved ${pngPath} in ${Date.now() - t0}ms`);
      return {
        content: [
          { type: "text", text: `Saved ${pngPath} (${p.width}x${p.height}, ${model})` },
          { type: "image", data: p.data, mimeType: p.mimeType },
        ],
      };
    } catch (e: any) {
      log("generate_image failed:", e?.message ?? e);
      return errorResult(e instanceof ToolError ? e.message : `generate_image failed: ${String(e?.message ?? e)}`);
    }
  },
);

server.registerTool(
  "view_image",
  {
    description: "Look at an image file (a reference or a previous output). Returns a downscaled preview plus its real dimensions.",
    inputSchema: {
      path: z.string().describe("Absolute path, or relative to the thread folder."),
      max_side: z.number().int().min(64).max(2048).optional().describe("Longest side of the preview in pixels. Default 1024."),
    },
  },
  async (input) => {
    try {
      const abs = resolveInput(input.path);
      const bytes = readFileSync(abs);
      const p = await preview(bytes, input.max_side ?? 1024);
      return {
        content: [
          { type: "text", text: `${abs}: ${p.width}x${p.height}, ${(statSync(abs).size / 1024).toFixed(0)} KB` },
          { type: "image", data: p.data, mimeType: p.mimeType },
        ],
      };
    } catch (e: any) {
      return errorResult(e instanceof ToolError ? e.message : `view_image failed: ${String(e?.message ?? e)}`);
    }
  },
);

const configured = Object.values(MODELS).filter(hasKey).length;
log(`starting; output=${OUTPUT_DIR}; ${configured}/${Object.keys(MODELS).length} models configured`);
await server.connect(new StdioServerTransport());
