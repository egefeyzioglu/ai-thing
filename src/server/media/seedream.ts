import "server-only";

import { env } from "src/env";

const SEEDREAM_GENERATIONS_ENDPOINT =
  "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
const SEEDREAM_REQUEST_TIMEOUT_MS = 120_000;

const SLUG_TO_MODELARK_ID = {
  "dola-seedream-5-0-lite": "seedream-5-0-260128",
  "dola-seedream-5-0-pro": "dola-seedream-5-0-pro-260628",
} as const;

export type SeedreamSlug = keyof typeof SLUG_TO_MODELARK_ID;

export function modelarkSeedreamModelIdForSlug(slug: SeedreamSlug): string {
  return SLUG_TO_MODELARK_ID[slug];
}

const SEEDREAM_SIZE_BY_MODEL = {
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
} as const;

export function resolveSeedreamSize(
  slug: SeedreamSlug,
  resolution?: string,
  aspectRatio?: string,
): string | undefined {
  if (!resolution) return undefined;

  const sizes = SEEDREAM_SIZE_BY_MODEL[slug];
  const dimensions = sizes[resolution as keyof typeof sizes] as
    | Record<string, string>
    | undefined;
  const size = dimensions?.[aspectRatio ?? ""];
  if (!size) {
    throw new Error(
      `Unsupported Seedream resolution/aspect ratio for ${slug}: ${resolution}/${aspectRatio ?? "unset"}`,
    );
  }
  return size;
}

type SeedreamResponseImage = {
  b64_json?: string;
  error?: { code?: string; message?: string };
};

type SeedreamResponse = {
  id?: string;
  model?: string;
  data?: SeedreamResponseImage[];
  usage?: {
    generated_images?: number;
    input_images?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
  };
  error?: { code?: string; message?: string };
};

export type SeedreamGenerationResult = {
  base64: string;
  mimeType: "image/png";
  providerRequestId: string | null;
  providerModel: string;
  usageRaw: unknown;
};

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.ARK_API_KEY}`,
  };
}

function normalizeBase64(value: string): string {
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,(.+)$/s.exec(value);
  return match?.[1] ?? value;
}

export async function generateSeedreamImage(args: {
  slug: SeedreamSlug;
  prompt: string;
  imageUrls?: string[];
  size?: string;
}): Promise<SeedreamGenerationResult> {
  const imageUrls = args.imageUrls ?? [];
  const image =
    imageUrls.length === 1
      ? imageUrls[0]
      : imageUrls.length > 1
        ? imageUrls
        : undefined;
  const providerModel = modelarkSeedreamModelIdForSlug(args.slug);
  const response = await fetch(SEEDREAM_GENERATIONS_ENDPOINT, {
    method: "POST",
    headers: authHeaders(),
    signal: AbortSignal.timeout(SEEDREAM_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: providerModel,
      prompt: args.prompt,
      ...(image !== undefined && { image }),
      ...(args.size !== undefined && { size: args.size }),
      output_format: "png",
      response_format: "b64_json",
      watermark: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Modelark Seedream API error (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as SeedreamResponse;
  if (data.error) {
    throw new Error(
      `Modelark Seedream API error (${data.error.code ?? "image_failed"}): ${data.error.message ?? "Unknown error"}`,
    );
  }
  const generated = data.data?.[0];
  if (generated?.error) {
    throw new Error(
      `Modelark Seedream API error (${generated.error.code ?? "image_failed"}): ${generated.error.message ?? "Unknown error"}`,
    );
  }
  const base64 = generated?.b64_json
    ? normalizeBase64(generated.b64_json)
    : undefined;
  if (!base64) {
    throw new Error("Modelark Seedream response did not contain an image");
  }

  return {
    base64,
    mimeType: "image/png",
    providerRequestId: data.id ?? response.headers.get("x-request-id"),
    providerModel: data.model ?? providerModel,
    usageRaw: data.usage ?? null,
  };
}
