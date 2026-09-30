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
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { adopt, commitVersion, family, isVersionable, parseVersionRef, readManifest, resolveVersionPath, restoreVersion, syncExternal, toRel, versionFile } from "../versions.js";

const OUTPUT_DIR = resolve(process.env.AITHING_OUTPUT_DIR ?? join(process.cwd(), "generated"));
const THREAD_CWD = resolve(process.env.AITHING_PROJECT_DIR ?? dirname(OUTPUT_DIR)); // project root: paths resolve and versions are stored here
const THREAD_ID = process.env.AITHING_THREAD_ID;
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

/** Relative paths resolve against the project root; if nothing is there, try this thread's output folder (agents often use bare filenames). */
function withOutputFallback(ref: string): string {
  const parsed = parseVersionRef(ref);
  if (isAbsolute(parsed.path) || existsSync(resolve(THREAD_CWD, parsed.path))) return ref;
  const inOut = join(OUTPUT_DIR, parsed.path);
  if (!existsSync(inOut)) return ref;
  const rel = toRel(THREAD_CWD, inOut) ?? inOut;
  return parsed.version === undefined ? rel : `${rel}@${parsed.version}`;
}

function resolveInput(path: string): string {
  return resolveVersionPath(THREAD_CWD, withOutputFallback(path)).abs;
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
  return (paths ?? []).map((p0) => {
    const p = withOutputFallback(p0);
    const resolved = resolveVersionPath(THREAD_CWD, p);
    const rel = toRel(THREAD_CWD, resolved.abs);
    // Capture disk changes before pinning a managed working image to its immutable version.
    if (resolved.version === undefined && rel && isVersionable(rel) && readManifest(THREAD_CWD, rel)) syncExternal(THREAD_CWD, rel);
    const manifest = resolved.version === undefined && rel ? readManifest(THREAD_CWD, rel) : null;
    const n = resolved.version ?? manifest?.current;
    const path = n === undefined ? resolved.abs : versionFile(THREAD_CWD, resolved.rel, n);
    return { path, ref: n === undefined ? p : `${resolved.rel}@${n}`, bytes: readFileSync(path), mimeType: mimeFor(path) };
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
      `Images are written to ${OUTPUT_DIR}. Files are versioned; use edit_image to iterate and path@N to address older versions. Alternatives you save under new names are linked to their source automatically.`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "generate_image",
  {
    description:
      "Generate an image from a prompt (optionally guided by reference images) and save it as a PNG in this thread's output folder. Reference images become the new image's parents in its history. Returns the saved path and a small preview of the result.",
    inputSchema: {
      prompt: z.string().min(1).describe("Detailed description of the image to create."),
      model: z.string().optional().describe(`Model id (see list_image_models). Default ${DEFAULT_MODEL}.`),
      aspect_ratio: z.string().optional().describe('e.g. "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3". Default "1:1".'),
      resolution: z.enum(["1K", "2K", "4K"]).optional().describe("Default: the model's lowest supported resolution."),
      reference_images: z.array(z.string()).optional().describe("Paths (absolute or relative to the thread folder, optionally path@N) of images to guide or edit."),
      output: z.string().optional().describe("Path (relative to the thread folder) of an EXISTING image to overwrite as a new version instead of creating a new file."),
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

      const target = input.output === undefined ? undefined : outputTarget(input.output);
      if (target && (!existsSync(target.abs) || !statSync(target.abs).isFile())) throw new ToolError("output must be an existing image.");
      log(`generate ${model} ${aspectRatio} ${resolution} refs=${refs.length}`);
      const t0 = Date.now();
      const generated = await GENERATORS[spec.provider]({ model, prompt: input.prompt, aspectRatio, resolution, refs });

      mkdirSync(OUTPUT_DIR, { recursive: true });
      const base = (input.filename?.trim() ? slugify(input.filename) : slugify(input.prompt) + "-" + Date.now().toString(36).slice(-5));
      const bytes = target ? await encodeFor(target.abs, generated.bytes) : generated.bytes;
      const p = await preview(bytes, 768);
      // Pick the filename after the last await so concurrent generations cannot claim the same name.
      const pngPath = target ? target.abs : uniquePath(OUTPUT_DIR, base, ".png");
      const rel = target ? target.rel : toRel(THREAD_CWD, pngPath);
      const committed = rel === null ? (writeFileSync(pngPath, bytes), null) : commitVersion(THREAD_CWD, rel, bytes, {
        kind: "generate", prompt: input.prompt, model, provider: spec.provider,
        providerModel: generated.providerModel, providerRequestId: generated.providerRequestId,
        aspectRatio, resolution, references: refs.map((r) => r.ref), durationMs: Date.now() - t0,
      }, { width: p.width, height: p.height, threadId: THREAD_ID, parents: refs.map((r) => r.ref) });
      log(`saved ${pngPath} in ${Date.now() - t0}ms`);
      return {
        content: [
          { type: "text", text: `Saved ${pngPath} (${p.width}x${p.height}, ${model})${committed ? ` — version ${committed.version.n}` : ""}` },
          { type: "image", data: p.data, mimeType: p.mimeType },
        ],
      };
    } catch (e: any) {
      log("generate_image failed:", e?.message ?? e);
      return errorResult(e instanceof ToolError ? e.message : `generate_image failed: ${String(e?.message ?? e)}`);
    }
  },
);

/** Resolve an output path: inside the project it must be a versionable image outside the store; outside the project it is written plainly. */
function outputTarget(path: string): { abs: string; rel: string | null } {
  const abs = resolve(THREAD_CWD, path);
  const rel = toRel(THREAD_CWD, abs);
  const inside = !relative(THREAD_CWD, abs).startsWith("..") && !isAbsolute(relative(THREAD_CWD, abs));
  if (inside && rel === null) throw new ToolError("output must not point inside the .aithing version store.");
  if (!/\.(png|jpe?g|webp|gif)$/i.test(abs)) throw new ToolError("output must be a png, jpg, webp or gif path.");
  return { abs, rel };
}

/** Providers return PNG; re-encode when the destination has another extension so bytes match the file type. */
async function encodeFor(abs: string, bytes: Buffer): Promise<Buffer> {
  switch (extname(abs).toLowerCase()) {
    case ".jpg": case ".jpeg": return sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
    case ".webp": return sharp(bytes).webp({ quality: 95 }).toBuffer();
    case ".gif": return sharp(bytes).gif().toBuffer();
    default: return bytes;
  }
}

function managedPath(path: string): string {
  const parsed = parseVersionRef(withOutputFallback(path));
  const rel = toRel(THREAD_CWD, resolve(THREAD_CWD, parsed.path));
  if (rel === null || !isVersionable(rel)) throw new ToolError("Expected a versionable image inside the thread folder.");
  return rel;
}

server.registerTool(
  "edit_image",
  {
    description: "Iterate on an existing image. Overwrite in place (default) to make the next version; pass `output` with a new name to branch off an alternative; pass `variants` to get several takes at once. All results are linked to the source version, so any filename is fine.",
    inputSchema: {
      path: z.string().describe("Image to iterate on, optionally path@N."),
      prompt: z.string().min(1),
      model: z.string().optional(),
      resolution: z.enum(["1K", "2K", "4K"]).optional(),
      extra_references: z.array(z.string()).optional().describe("Additional reference images, optionally path@N."),
      output: z.string().optional().describe("Alternate output path relative to the thread folder."),
      variants: z.number().int().min(1).max(8).optional().describe("Generate this many alternatives at once. Each is saved as its own file next to the source (stem-alt1, stem-alt2, ...) and recorded as a branch off the source version; the source is never overwritten when variants > 1."),
    },
  },
  async (input) => {
    try {
      const model = input.model ?? DEFAULT_MODEL;
      const spec = MODELS[model];
      if (!spec) throw new ToolError(`Unknown model "${model}". Known: ${Object.keys(MODELS).join(", ")}`);
      if (!spec.references) throw new ToolError(`${model} does not accept references. Use: ${Object.keys(MODELS).filter((id) => MODELS[id]!.references).join(", ")}`);
      if (!hasKey(spec)) throw new ToolError(`${model} is not available: ${spec.key} is not configured.`);
      const resolution = input.resolution ?? spec.resolutions[0]!;
      if (!spec.resolutions.includes(resolution)) throw new ToolError(`${model} does not support ${resolution}. Supported: ${spec.resolutions.join(", ")}`);
      const rel = managedPath(input.path);
      const requested = parseVersionRef(input.path).version;
      if (requested === undefined) syncExternal(THREAD_CWD, rel);
      const manifest = readManifest(THREAD_CWD, rel) ?? adopt(THREAD_CWD, rel);
      if (!manifest) throw new ToolError(`file not found: ${input.path}`);
      const was = requested ?? manifest.current;
      const refs = loadRefs([`${rel}@${was}`, ...(input.extra_references ?? [])]);
      const meta = await sharp(refs[0]!.bytes).metadata();
      if (!meta.width || !meta.height) throw new ToolError("Cannot infer source image dimensions.");
      const ratio = meta.width / meta.height;
      const aspectRatio = spec.aspectRatios.reduce((best, ar) => Math.abs(ratioValue(ar) - ratio) < Math.abs(ratioValue(best) - ratio) ? ar : best);
      const { abs, rel: outputRel } = outputTarget(input.output ?? rel);
      const t0 = Date.now();
      const sourceRef = `${rel}@${was}`;
      const variants = input.variants ?? 1;
      if (variants > 1) {
        const results = await Promise.allSettled(Array.from({ length: variants }, () => GENERATORS[spec.provider]({ model, prompt: input.prompt, aspectRatio, resolution, refs })));
        const successes = results.map((r, i) => ({ r, i })).filter((x): x is { r: PromiseFulfilledResult<Generated>; i: number } => x.r.status === "fulfilled");
        if (!successes.length) throw new ToolError(results.map((r, i) => r.status === "rejected" ? `variant ${i + 1}: ${String(r.reason?.message ?? r.reason)}` : "").filter(Boolean).join("\n") || "all variants failed");
        const dir = dirname(abs);
        const ext = extname(abs) || ".png";
        const stem = basename(abs, ext);
        const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/jpeg" })[] = [];
        const lines: string[] = [];
        for (const { r, i } of successes) {
          const targetAbs = uniquePath(dir, `${stem}-alt${i + 1}`, ext);
          const targetRel = toRel(THREAD_CWD, targetAbs);
          const bytes = await encodeFor(targetAbs, r.value.bytes);
          const p = await preview(bytes, 512);
          const source = { kind: "edit" as const, prompt: input.prompt, model, provider: spec.provider,
            providerModel: r.value.providerModel, providerRequestId: r.value.providerRequestId,
            aspectRatio, resolution, references: refs.map((ref) => ref.ref), durationMs: Date.now() - t0 };
          let n: number | undefined;
          if (targetRel === null) { mkdirSync(dirname(targetAbs), { recursive: true }); writeFileSync(targetAbs, bytes); }
          else n = commitVersion(THREAD_CWD, targetRel, bytes, source, { width: p.width, height: p.height, threadId: THREAD_ID, parents: [sourceRef] }).version.n;
          lines.push(`${targetRel ?? targetAbs} (${p.width}x${p.height})${n === undefined ? "" : ` — version ${n}`}`);
          content.push({ type: "image", data: p.data, mimeType: p.mimeType });
        }
        for (const { r, i } of results.map((r, i) => ({ r, i }))) if (r.status === "rejected") lines.push(`variant ${i + 1} failed: ${String(r.reason?.message ?? r.reason)}`);
        return { content: [{ type: "text", text: lines.join("\n") }, ...content] };
      }
      const generated = await GENERATORS[spec.provider]({ model, prompt: input.prompt, aspectRatio, resolution, refs });
      const bytes = await encodeFor(abs, generated.bytes);
      const p = await preview(bytes, 768);
      const source = { kind: "edit" as const, prompt: input.prompt, model, provider: spec.provider,
        providerModel: generated.providerModel, providerRequestId: generated.providerRequestId,
        aspectRatio, resolution, references: refs.map((r) => r.ref), durationMs: Date.now() - t0 };
      let n: number | undefined;
      if (outputRel === null) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, bytes); }
      else n = commitVersion(THREAD_CWD, outputRel, bytes, source, { width: p.width, height: p.height, threadId: THREAD_ID, parents: [sourceRef] }).version.n;
      return { content: [
        { type: "text", text: `Saved ${abs} (${p.width}x${p.height}, ${model})${n === undefined ? "" : ` — version ${n}`} (was version ${was})` },
        { type: "image", data: p.data, mimeType: p.mimeType },
      ] };
    } catch (e: any) { return errorResult(`edit_image failed: ${String(e?.message ?? e)}`); }
  },
);

server.registerTool(
  "image_history",
  { description: "List an image's versions and preview its current version.", inputSchema: { path: z.string() } },
  async ({ path }) => {
    try {
      const rel = managedPath(path);
      syncExternal(THREAD_CWD, rel);
      const manifest = readManifest(THREAD_CWD, rel);
      if (!manifest) throw new ToolError(`No history for ${path}`);
      const lines = ["version | createdAt | source | model | prompt | dimensions", ...manifest.versions.map((v) => {
        const source = v.source;
        const prompt = "prompt" in source ? source.prompt.replace(/[\r\n|]/g, " ").slice(0, 80) : "";
        return `${v.n}${v.n === manifest.current ? " (current)" : ""} | ${v.createdAt} | ${source.kind} | ${"model" in source ? source.model : ""} | ${prompt} | ${v.width ?? "?"}x${v.height ?? "?"}`;
      })];
      const cur = manifest.versions.find((v) => v.n === manifest.current)!;
      lines.push("", `Derived from: ${(cur.parents ?? []).join(", ") || "(none)"}`);
      const graph = family(THREAD_CWD, rel);
      const currentParents = new Set(cur.parents ?? []);
      const related = graph.nodes.filter((n) => n.current && n.path !== rel).sort((a, b) => a.path.localeCompare(b.path));
      if (related.length) {
        lines.push("", "Related:");
        for (const node of related) {
          const prompt = node.prompt ? node.prompt.replace(/[\r\n|]/g, " ").slice(0, 80) : "";
          const alternative = node.parents.some((p) => currentParents.has(p)) ? " alternative" : "";
          lines.push(`${node.path}@${node.n} | ${node.kind}${alternative}${prompt ? ` | ${prompt}` : ""}`);
        }
      }
      const p = await preview(readFileSync(versionFile(THREAD_CWD, rel, manifest.current)), 768);
      return { content: [{ type: "text", text: lines.join("\n") }, { type: "image", data: p.data, mimeType: p.mimeType }] };
    } catch (e: any) { return errorResult(`image_history failed: ${String(e?.message ?? e)}`); }
  },
);

server.registerTool(
  "restore_image_version",
  { description: "Restore a stored image version as the working image, preserving history.", inputSchema: { path: z.string(), version: z.number().int().positive() } },
  async ({ path, version }) => {
    try {
      const rel = managedPath(path);
      const bytes = readFileSync(resolveVersionPath(THREAD_CWD, `${rel}@${version}`).abs);
      const p = await preview(bytes, 768);
      const result = restoreVersion(THREAD_CWD, rel, version, { width: p.width, height: p.height, threadId: THREAD_ID });
      return { content: [
        { type: "text", text: `Saved ${resolve(THREAD_CWD, rel)} (${p.width}x${p.height}) — version ${result.version.n} (restored version ${version})` },
        { type: "image", data: p.data, mimeType: p.mimeType },
      ] };
    } catch (e: any) { return errorResult(`restore_image_version failed: ${String(e?.message ?? e)}`); }
  },
);

server.registerTool(
  "view_image",
  {
    description: "Look at an image file (a reference or a previous output). Returns a downscaled preview plus its real dimensions.",
    inputSchema: {
      path: z.string().describe("Absolute path, or relative to the thread folder; use path@N for a stored version."),
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
