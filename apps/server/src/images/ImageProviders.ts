// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalFetch:off - provider calls are plain promises shared with the PoC; keys never leave this module
/**
 * Image generation providers. Keys come from the server process environment
 * (the dev runner loads the repo `.env`); they never reach agent processes.
 */
import sharp from "sharp";
import * as NodePath from "node:path";

import type { ImageModelInfo, ImageResolution } from "@t3tools/contracts";

export type Provider = "openai" | "gemini" | "modelark";
export type ProviderKey = "OPENAI_API_KEY" | "GEMINI_API_KEY" | "ARK_API_KEY";

export type ModelSpec = {
  provider: Provider;
  key: ProviderKey;
  resolutions: ImageResolution[];
  aspectRatios: string[];
  references: boolean;
  note: string;
  /** Rough USD per image by resolution; used for the cost record and the permission gate. */
  cost: Partial<Record<ImageResolution, number>>;
};

const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const SEEDREAM_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

export const MODELS: Record<string, ModelSpec> = {
  "gemini-2.5-flash-image": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K"],
    aspectRatios: GEMINI_RATIOS,
    references: true,
    note: "Fast, cheap default. Good for drafts, iteration, and edits with reference images.",
    cost: { "1K": 0.039 },
  },
  "gemini-3.1-flash-image-preview": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: GEMINI_RATIOS,
    references: true,
    note: "Newer Gemini flash image model with higher resolutions.",
    cost: { "1K": 0.067, "2K": 0.1, "4K": 0.15 },
  },
  "gemini-3-pro-image-preview": {
    provider: "gemini",
    key: "GEMINI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: GEMINI_RATIOS,
    references: true,
    note: "Highest-quality Gemini option; slower. Strong at text and complex compositions.",
    cost: { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
  },
  "gpt-image-2": {
    provider: "openai",
    key: "OPENAI_API_KEY",
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: ["1:1", "3:2", "2:3"],
    references: true,
    note: "OpenAI image model. Excellent prompt adherence and typography; supports edits with references.",
    cost: { "1K": 0.04, "2K": 0.17, "4K": 0.6 },
  },
  "dola-seedream-5-0-lite": {
    provider: "modelark",
    key: "ARK_API_KEY",
    resolutions: ["2K", "4K"],
    aspectRatios: SEEDREAM_RATIOS,
    references: true,
    note: "BytePlus Seedream 5.0 Lite. Photoreal, high resolution, good value.",
    cost: { "2K": 0.025, "4K": 0.03 },
  },
  "dola-seedream-5-0-pro": {
    provider: "modelark",
    key: "ARK_API_KEY",
    resolutions: ["1K", "2K"],
    aspectRatios: SEEDREAM_RATIOS,
    references: true,
    note: "BytePlus Seedream 5.0 Pro. Best Seedream quality; slower.",
    cost: { "1K": 0.04, "2K": 0.04 },
  },
};
export const DEFAULT_MODEL = "gemini-2.5-flash-image";

const SEEDREAM_MODEL_ID: Record<string, string> = {
  "dola-seedream-5-0-lite": "seedream-5-0-260128",
  "dola-seedream-5-0-pro": "dola-seedream-5-0-pro-260628",
};
const SEEDREAM_SIZES: Record<string, Partial<Record<ImageResolution, Record<string, string>>>> = {
  "dola-seedream-5-0-lite": {
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2304x1728",
      "3:4": "1728x2304",
      "16:9": "2848x1600",
      "9:16": "1600x2848",
    },
    "4K": {
      "1:1": "4096x4096",
      "4:3": "4704x3520",
      "3:4": "3520x4704",
      "16:9": "5504x3040",
      "9:16": "3040x5504",
    },
  },
  "dola-seedream-5-0-pro": {
    "1K": {
      "1:1": "1024x1024",
      "4:3": "1152x864",
      "3:4": "864x1152",
      "16:9": "1424x800",
      "9:16": "800x1424",
    },
    "2K": {
      "1:1": "2048x2048",
      "4:3": "2368x1776",
      "3:4": "1776x2368",
      "16:9": "2816x1584",
      "9:16": "1584x2816",
    },
  },
};

function hasKey(spec: ModelSpec, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[spec.key]);
}

export function listModels(env: NodeJS.ProcessEnv = process.env): ImageModelInfo[] {
  return Object.entries(MODELS).map(([id, m]) => ({
    id,
    provider: m.provider,
    available: hasKey(m, env),
    key: m.key,
    isDefault: id === DEFAULT_MODEL,
    resolutions: m.resolutions,
    aspectRatios: m.aspectRatios,
    references: m.references,
    note: m.note,
    estimatedCostUsd: Object.fromEntries(
      Object.entries(m.cost).filter(([, v]) => v !== undefined),
    ) as Record<string, number>,
  }));
}

export function estimateCost(model: string, resolution: ImageResolution): number | undefined {
  return MODELS[model]?.cost[resolution];
}

class ImageProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export type Reference = { path: string; bytes: Buffer; mimeType: string };
export type GenArgs = {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: ImageResolution;
  refs: Reference[];
  env?: NodeJS.ProcessEnv;
};
export type Generated = {
  bytes: Buffer;
  mimeType: "image/png";
  providerRequestId: string | null;
  providerModel: string;
};

function ratioValue(ar: string): number {
  const [w, h] = ar.split(":").map(Number);
  return w! / h!;
}

export function closestAspectRatio(spec: ModelSpec, width: number, height: number): string {
  const ratio = width / height;
  return spec.aspectRatios.reduce((best, ar) =>
    Math.abs(ratioValue(ar) - ratio) < Math.abs(ratioValue(best) - ratio) ? ar : best,
  );
}

async function providerFetch(
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok)
    throw new ImageProviderError(`${label} error (${res.status}): ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ImageProviderError(`${label} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function stripDataUrl(b64: string): string {
  return /^data:[^;]+;base64,(.+)$/s.exec(b64)?.[1] ?? b64;
}

async function genOpenAI(a: GenArgs): Promise<Generated> {
  const env = a.env ?? process.env;
  const modelId = "gpt-image-2-2026-04-21";
  const r = ratioValue(a.aspectRatio);
  const sq = { "1K": 1024, "2K": 2048, "4K": 4096 }[a.resolution];
  const lg = { "1K": 1536, "2K": 3072, "4K": 6144 }[a.resolution];
  const size = r > 1 ? `${lg}x${sq}` : r < 1 ? `${sq}x${lg}` : `${sq}x${sq}`;
  const headers = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  let data: any;
  if (a.refs.length) {
    const form = new FormData();
    form.set("model", modelId);
    form.set("prompt", a.prompt);
    form.set("size", size);
    form.set("output_format", "png");
    for (const ref of a.refs) {
      form.append(
        "image[]",
        new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }),
        NodePath.basename(ref.path),
      );
    }
    data = await providerFetch(
      "OpenAI Images (edits)",
      "https://api.openai.com/v1/images/edits",
      { method: "POST", headers, body: form },
      300_000,
    );
  } else {
    data = await providerFetch(
      "OpenAI Images",
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt: a.prompt, size, output_format: "png" }),
      },
      300_000,
    );
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ImageProviderError("OpenAI response did not contain an image");
  return {
    bytes: Buffer.from(b64, "base64"),
    mimeType: "image/png",
    providerRequestId: data.id ?? null,
    providerModel: data.model ?? modelId,
  };
}

async function genGemini(a: GenArgs): Promise<Generated> {
  const env = a.env ?? process.env;
  const parts: unknown[] = a.refs.map((r) => ({
    inline_data: { mime_type: r.mimeType, data: r.bytes.toString("base64") },
  }));
  parts.push({ text: a.prompt });
  const imageConfig: Record<string, string> = { aspectRatio: a.aspectRatio };
  if (a.model !== "gemini-2.5-flash-image") imageConfig.imageSize = a.resolution;
  const data = await providerFetch(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${a.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig },
      }),
    },
    300_000,
  );
  const inline = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p.inlineData ?? p.inline_data)
    .find((d: any) => d?.data);
  if (!inline) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
    throw new ImageProviderError(
      `Gemini response did not contain an image${reason ? ` (${reason})` : ""}`,
    );
  }
  let bytes = Buffer.from(inline.data, "base64");
  const mime = inline.mimeType ?? inline.mime_type ?? "image/png";
  if (mime !== "image/png") bytes = await sharp(bytes).png().toBuffer();
  return {
    bytes,
    mimeType: "image/png",
    providerRequestId: data.responseId ?? null,
    providerModel: data.modelVersion ?? a.model,
  };
}

async function genSeedream(a: GenArgs): Promise<Generated> {
  const env = a.env ?? process.env;
  const size = SEEDREAM_SIZES[a.model]?.[a.resolution]?.[a.aspectRatio];
  if (!size)
    throw new ImageProviderError(
      `Unsupported resolution/aspect ratio for ${a.model}: ${a.resolution}/${a.aspectRatio}`,
    );
  const urls = a.refs.map((r) => `data:${r.mimeType};base64,${r.bytes.toString("base64")}`);
  const image = urls.length === 1 ? urls[0] : urls.length > 1 ? urls : undefined;
  const data = await providerFetch(
    "ModelArk Seedream",
    "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.ARK_API_KEY}` },
      body: JSON.stringify({
        model: SEEDREAM_MODEL_ID[a.model],
        prompt: a.prompt,
        ...(image && { image }),
        size,
        output_format: "png",
        response_format: "b64_json",
        watermark: false,
      }),
    },
    300_000,
  );
  const err = data?.error ?? data?.data?.[0]?.error;
  if (err)
    throw new ImageProviderError(
      `ModelArk Seedream error (${err.code ?? "image_failed"}): ${err.message ?? "unknown"}`,
    );
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ImageProviderError("Seedream response did not contain an image");
  return {
    bytes: Buffer.from(stripDataUrl(b64), "base64"),
    mimeType: "image/png",
    providerRequestId: data.id ?? null,
    providerModel: data.model ?? SEEDREAM_MODEL_ID[a.model]!,
  };
}

const GENERATORS: Record<Provider, (a: GenArgs) => Promise<Generated>> = {
  openai: genOpenAI,
  gemini: genGemini,
  modelark: genSeedream,
};

/** Validate against the model spec and call the provider. Throws ImageProviderError. */
export async function generate(a: GenArgs): Promise<Generated> {
  const spec = MODELS[a.model];
  if (!spec)
    throw new ImageProviderError(
      `Unknown model "${a.model}". Known: ${Object.keys(MODELS).join(", ")}`,
    );
  if (!hasKey(spec, a.env))
    throw new ImageProviderError(`${a.model} is not available: ${spec.key} is not configured.`);
  if (!spec.aspectRatios.includes(a.aspectRatio)) {
    throw new ImageProviderError(
      `${a.model} does not support aspect ratio ${a.aspectRatio}. Supported: ${spec.aspectRatios.join(", ")}`,
    );
  }
  if (!spec.resolutions.includes(a.resolution)) {
    throw new ImageProviderError(
      `${a.model} does not support ${a.resolution}. Supported: ${spec.resolutions.join(", ")}`,
    );
  }
  if (a.refs.length && !spec.references)
    throw new ImageProviderError(`${a.model} does not accept reference images.`);
  return GENERATORS[spec.provider](a);
}

export type Preview = { data: string; mimeType: "image/jpeg"; width: number; height: number };

/** JPEG preview for agent context and the event log: much smaller than PNG for photographic output. */
export async function preview(bytes: Buffer, maxSide: number): Promise<Preview> {
  const img = sharp(bytes);
  const meta = await img.metadata();
  const out = await img
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return {
    data: out.toString("base64"),
    mimeType: "image/jpeg",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

export async function dimensions(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

export function mimeFor(path: string): string {
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  switch (ext) {
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

/** Providers return PNG; re-encode when the destination has another extension. */
export async function encodeFor(path: string, bytes: Buffer): Promise<Buffer> {
  switch (path.toLowerCase().slice(path.lastIndexOf("."))) {
    case ".jpg":
    case ".jpeg":
      return sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer();
    case ".webp":
      return sharp(bytes).webp({ quality: 95 }).toBuffer();
    case ".gif":
      return sharp(bytes).gif().toBuffer();
    default:
      return bytes;
  }
}
