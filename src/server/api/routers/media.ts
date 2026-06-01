import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { MONTHLY_CREDIT_LIMIT } from "src/lib/credits";
import { extensionFor } from "src/lib/utils";

import { env } from "src/env";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  generationUsage,
  media,
  prompts,
  referenceImages,
  type GenerationCostEventOperation,
  type Media,
  type ReferenceImage,
} from "src/server/db/schema";
import { recordGenerationCostEvent } from "src/server/generation-costs";
import { currentUserCanBypassLimits } from "src/server/limits";
import {
  isSeedanceSlug,
  pollSeedanceTask,
  submitSeedanceTask,
} from "src/server/media/seedance";
import { signUploadThingUrl, utapi, UTFile } from "src/server/uploadthing";
import {
  createReservedUsage,
  getUsedCredits,
  lockUserUsage,
  markUsageStatus,
} from "src/server/usage";
import { getPostHogClient } from "src/lib/posthog-server";

const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;

type ResponsesApiOutputItem = {
  id?: string;
  type: string;
  result?: string;
  status?: string;
  usage?: unknown;
  [key: string]: unknown;
};

type ResponsesApiResponse = {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  output?: ResponsesApiOutputItem[];
  error?: { message?: string };
};

type OpenAIImagesApiResponse = {
  id?: string;
  created?: number;
  model?: string;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: {
      image_tokens?: number;
      text_tokens?: number;
    };
    output_tokens?: number;
    total_tokens?: number;
  };
  data?: { b64_json?: string }[];
  error?: { message?: string };
};

type GeminiInlineData = {
  mimeType?: string;
  data?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: GeminiInlineData;
  inline_data?: GeminiInlineData;
};

type GeminiModalityTokenCount = {
  modality?: string;
  tokenCount?: number;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  toolUsePromptTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  promptTokensDetails?: GeminiModalityTokenCount[];
  cacheTokensDetails?: GeminiModalityTokenCount[];
  candidatesTokensDetails?: GeminiModalityTokenCount[];
  toolUsePromptTokensDetails?: GeminiModalityTokenCount[];
  serviceTier?: string;
};

type GeminiResponse = {
  responseId?: string;
  modelVersion?: string;
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: GeminiUsageMetadata;
  error?: { message?: string };
};

type GeneratedImage = {
  base64: string;
  mimeType: string;
  cost: {
    provider: "openai" | "gemini";
    providerRequestId?: string | null;
    providerModel?: string | null;
    operation: GenerationCostEventOperation;
    usageRaw: unknown;
    fallbackContext?: GenerationCostFallbackContext;
  };
};

type GenerationCostFallbackContext = {
  resolution?: string | null;
  aspectRatio?: string | null;
  outputImageCount?: number;
  size?: string | null;
  quality?: string | null;
  background?: string | null;
  negativePrompt?: string | null;
  seed?: string | null;
  thinking?: string | null;
};

function advancedCostContext(
  advanced?: AdvancedSettings,
): Pick<
  GenerationCostFallbackContext,
  "quality" | "background" | "negativePrompt" | "seed" | "thinking"
> {
  return {
    quality: advanced?.quality ?? "auto",
    background: advanced?.background ?? "auto",
    negativePrompt: advanced?.negativePrompt ?? null,
    seed: advanced?.seed ?? null,
    thinking: advanced?.thinking ?? "auto",
  };
}

const OPENAI_IMAGE_MAX_EDGE = 3840;
const OPENAI_IMAGE_MIN_PIXELS = 655_360;
const OPENAI_IMAGE_MAX_PIXELS = 8_294_400;

function parseResolutionPreset(resolution?: string): number | undefined {
  switch (resolution) {
    case "512":
      return 512;
    case "1024":
    case "1K":
      return 1024;
    case "2048":
    case "2K":
      return 2048;
    case "4096":
    case "4K":
      return 4096;
    default:
      return undefined;
  }
}

function resolveImageSize(
  resolution?: string,
  aspectRatio?: string,
): string | undefined {
  const parsedResolution = parseResolutionPreset(resolution);
  if (parsedResolution === undefined) {
    return undefined;
  }

  const [rawWidth, rawHeight] = aspectRatio?.split(":") ?? [];
  const parsedWidthRatio = Number(rawWidth);
  const parsedHeightRatio = Number(rawHeight);
  const widthRatio =
    Number.isFinite(parsedWidthRatio) && parsedWidthRatio > 0
      ? parsedWidthRatio
      : 1;
  const heightRatio =
    Number.isFinite(parsedHeightRatio) && parsedHeightRatio > 0
      ? parsedHeightRatio
      : 1;
  const targetScale = parsedResolution / Math.min(widthRatio, heightRatio);
  let width = widthRatio * targetScale;
  let height = heightRatio * targetScale;

  if (Math.max(width, height) > OPENAI_IMAGE_MAX_EDGE) {
    const edgeScale = OPENAI_IMAGE_MAX_EDGE / Math.max(width, height);
    width *= edgeScale;
    height *= edgeScale;
  }

  let pixels = width * height;
  if (pixels > OPENAI_IMAGE_MAX_PIXELS) {
    const pixelScale = Math.sqrt(OPENAI_IMAGE_MAX_PIXELS / pixels);
    width *= pixelScale;
    height *= pixelScale;
  }

  width &= 0xfffffff0;
  height &= 0xfffffff0;

  if (width < 16 || height < 16) {
    console.error("[resolveImageSize] Computed dimensions are too small", {
      resolution,
      aspectRatio,
      width,
      height,
    });
    return undefined;
  }

  pixels = width * height;
  if (pixels < OPENAI_IMAGE_MIN_PIXELS || pixels > OPENAI_IMAGE_MAX_PIXELS) {
    console.error("[resolveImageSize] Computed dimensions violate pixel constraints", {
      resolution,
      aspectRatio,
      width,
      height,
      pixels,
    });
    return undefined;
  }

  return `${width}x${height}`;
}

// Gemini-allowed aspect ratios
const GEMINI_ALLOWED_ASPECT_RATIOS = new Set([
  "1:1",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

async function signMediaRow<T extends { url: string | null }>(
  row: T,
): Promise<T> {
  return {
    ...row,
    url: row.url ? await signUploadThingUrl(row.url) : row.url,
  };
}

function parseReferenceImageIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
}

function redactErrorMessage(message: string) {
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|phc)_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 240);
}

function imageGenerationErrorCode(error: unknown, message: string) {
  if (error instanceof TRPCError) return `trpc_${error.code.toLowerCase()}`;
  if (message.startsWith("OpenAI API error")) return "openai_api_error";
  if (message.startsWith("OpenAI Images API error")) {
    return "openai_images_api_error";
  }
  if (message.startsWith("Gemini API error")) return "gemini_api_error";
  if (message.startsWith("UploadThing upload failed")) return "upload_failed";
  if (message.includes("did not contain an image")) return "empty_image_response";
  if (message.startsWith("Unsupported model")) return "unsupported_model";
  return "unknown_generation_error";
}

async function loadOwnedReferenceImages(
  userId: string,
  referenceImageIds?: string[],
): Promise<ReferenceImage[]> {
  const dedupedIds = Array.from(new Set(referenceImageIds ?? []));
  if (dedupedIds.length === 0) return [];

  const ownedReferenceImages = await db
    .select()
    .from(referenceImages)
    .where(
      and(
        eq(referenceImages.userId, userId),
        inArray(referenceImages.id, dedupedIds),
      ),
    );

  if (ownedReferenceImages.length !== dedupedIds.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "One or more reference images do not belong to the current user",
    });
  }

  return Promise.all(
    ownedReferenceImages.map((image) => signMediaRow(image)),
  );
}

async function generateImageOpenAIResponses(
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
  advanced?: AdvancedSettings,
): Promise<GeneratedImage> {
  const ownedReferenceImages = await loadOwnedReferenceImages(
    userId,
    referenceImageIds,
  );
  const modelInputs = [
    {
      type: "input_text",
      text: `Generate an image for the following user prompt: ${prompt}`,
    },
    ...ownedReferenceImages.map((image) => ({
      type: "input_image",
      image_url: image.url,
    })),
  ];
  const size = resolveImageSize(resolution, aspectRatio) ?? "auto";

  const imageTool: Record<string, unknown> = {
    type: "image_generation",
    size,
    output_format: "png",
  };
  if (advanced?.quality) imageTool.quality = advanced.quality;
  if (advanced?.background) imageTool.background = advanced.background;

  const body = JSON.stringify({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: [...modelInputs],
      },
    ],
    tools: [imageTool],
  });

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    // TODO: Make this typesafe
    body: body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ResponsesApiResponse;

  const imageCall = data.output?.find(
    (item) => item.type === "image_generation_call" && item.result,
  );

  if (!imageCall?.result) {
    throw new Error("OpenAI response did not contain an image");
  }

  return {
    base64: imageCall.result,
    mimeType: "image/png",
    cost: {
      provider: "openai",
      providerRequestId: data.id ?? imageCall.id ?? null,
      providerModel: data.model ?? "gpt-5.4-mini",
      operation: "responses_image_generation",
      usageRaw: {
        responseUsage: data.usage ?? null,
        imageGenerationCallUsage: imageCall.usage ?? null,
      },
      fallbackContext: {
        size,
        ...advancedCostContext(advanced),
      },
    },
  };
}

async function generateImageGptImage2Generations(
  prompt: string,
  model: ["gpt-image-2-2026-04-21"][number],
  size: string,
  advanced?: AdvancedSettings,
): Promise<GeneratedImage | undefined> {
  const body = JSON.stringify({
    model,
    prompt,
    size,
    output_format: "png",
    ...(advanced?.quality && { quality: advanced.quality }),
    ...(advanced?.background && { background: advanced.background }),
  });
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Images API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OpenAIImagesApiResponse;
  const imageBase64 = data.data?.[0]?.b64_json;

  if (!imageBase64) {
    return undefined;
  }

  return {
    base64: imageBase64,
    mimeType: "image/png",
    cost: {
      provider: "openai",
      providerRequestId: data.id ?? null,
      providerModel: data.model ?? model,
      operation: "image_generation",
      usageRaw: data.usage ?? null,
      fallbackContext: {
        size,
        ...advancedCostContext(advanced),
      },
    },
  };
}

async function generateImageGptImage2Edits(
  prompt: string,
  size: string,
  referenceImages: ReferenceImage[],
  advanced?: AdvancedSettings,
): Promise<GeneratedImage | undefined> {
  const body = JSON.stringify({
    model: "gpt-image-2-2026-04-21",
    prompt,
    images: referenceImages.map((image) => ({
      image_url: image.url,
    })),
    size,
    output_format: "png",
    ...(advanced?.quality && { quality: advanced.quality }),
    ...(advanced?.background && { background: advanced.background }),
  });
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Images API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OpenAIImagesApiResponse;
  const imageBase64 = data.data?.[0]?.b64_json;

  if (!imageBase64) {
    return undefined;
  }

  return {
    base64: imageBase64,
    mimeType: "image/png",
    cost: {
      provider: "openai",
      providerRequestId: data.id ?? null,
      providerModel: data.model ?? "gpt-image-2-2026-04-21",
      operation: "image_edit",
      usageRaw: data.usage ?? null,
      fallbackContext: {
        size,
        ...advancedCostContext(advanced),
      },
    },
  };
}

async function generateImageGptImage2(
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
  advanced?: AdvancedSettings,
): Promise<GeneratedImage> {
  const ownedReferenceImages = await loadOwnedReferenceImages(
    userId,
    referenceImageIds,
  );
  const size = resolveImageSize(resolution, aspectRatio) ?? "auto";

  const image = await (ownedReferenceImages.length > 0
    ? generateImageGptImage2Edits(prompt, size, ownedReferenceImages, advanced)
    : generateImageGptImage2Generations(
        prompt,
        "gpt-image-2-2026-04-21",
        size,
        advanced,
      ));

  if (!image) {
    throw new Error("OpenAI Images API response did not contain an image");
  }

  return image;
}

async function generateImageGeminiModel(
  model: [
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
  ][number],
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
  advanced?: AdvancedSettings,
): Promise<GeneratedImage> {
  const ownedReferenceImages = await loadOwnedReferenceImages(
    userId,
    referenceImageIds,
  );
  const referenceImageInputs = (
    await Promise.all(
      ownedReferenceImages.map(async (image) => {
        if (!image?.url) return undefined;
        const imageBytes = await (await fetch(image.url)).bytes();
        return {
          b64: Buffer.from(imageBytes).toString("base64"),
          mimeType: image.mimeType,
        };
      }),
    )
  ).filter((x): x is { b64: string; mimeType: string } => x !== undefined);
  const negativePrompt = advanced?.negativePrompt?.trim();
  const promptWithNegatives = negativePrompt
    ? `${prompt}\n\nAvoid the following in the image: ${negativePrompt}`
    : prompt;
  const modelInputs = [
    ...referenceImageInputs.map((image) => ({
      inline_data: {
        mime_type: image.mimeType,
        data: image.b64,
      },
    })),
    {
      text:
        "Generate an image based on the following user input:" +
        promptWithNegatives,
    },
  ];
  // Map resolution to Gemini imageSize
  let imageSize: string | undefined;
  const parsedResolution = parseResolutionPreset(resolution);
  if (parsedResolution) {
    if (parsedResolution <= 512) imageSize = "512";
    else if (parsedResolution <= 1024) imageSize = "1K";
    else if (parsedResolution <= 2048) imageSize = "2K";
    else imageSize = "4K";
  }

  // Validate aspectRatio against Gemini's whitelist
  if (aspectRatio && !GEMINI_ALLOWED_ASPECT_RATIOS.has(aspectRatio)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid aspect ratio "${aspectRatio}". Allowed values: ${[...GEMINI_ALLOWED_ASPECT_RATIOS].join(", ")}`,
    });
  }

  const requestBody: Record<string, unknown> = {
    contents: [{ parts: [...modelInputs] }],
  };

  const parsedSeed =
    advanced?.seed && /^\d+$/.test(advanced.seed)
      ? Number(advanced.seed)
      : undefined;
  const isGemini3 = model.startsWith("gemini-3");
  let thinkingConfig: Record<string, unknown> | undefined;
  if (isGemini3 && advanced?.thinking && advanced.thinking !== "auto") {
    if (advanced.thinking === "off") {
      thinkingConfig = { thinkingBudget: 0 };
    } else {
      thinkingConfig = { thinkingLevel: advanced.thinking };
    }
  }

  requestBody.generationConfig = {
    responseModalities: ["IMAGE"],
    ...((imageSize != null || aspectRatio != null) && {
      imageConfig: {
        ...(imageSize && { imageSize }),
        ...(aspectRatio && { aspectRatio }),
      },
    }),
    ...(parsedSeed !== undefined && { seed: parsedSeed }),
    ...(thinkingConfig && { thinkingConfig }),
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as GeminiResponse;

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inline = parts
    .map((p) => p.inlineData ?? p.inline_data)
    .find((d): d is GeminiInlineData => !!d?.data);

  if (!inline?.data) {
    throw new Error("Gemini response did not contain an image");
  }

  return {
    base64: inline.data,
    mimeType: inline.mimeType ?? "image/png",
    cost: {
      provider: "gemini",
      providerRequestId: data.responseId ?? null,
      providerModel: data.modelVersion ?? model,
      operation: "image_generation",
      usageRaw: data.usageMetadata ?? null,
      fallbackContext: advancedCostContext(advanced),
    },
  };
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(b64, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

async function uploadGeneratedImage(args: {
  mediaId: string;
  generated: GeneratedImage;
}): Promise<{ url: string; key: string }> {
  const ext = extensionFor(args.generated.mimeType);
  const file = new UTFile(
    [base64ToBytes(args.generated.base64)],
    `${args.mediaId}.${ext}`,
    { type: args.generated.mimeType },
  );

  const uploaded = await utapi.uploadFiles(file, { acl: "private" });

  if (uploaded.error || !uploaded.data) {
    throw new Error(
      `UploadThing upload failed: ${uploaded.error?.message ?? "unknown error"}`,
    );
  }

  return { url: uploaded.data.ufsUrl, key: uploaded.data.key };
}

type AdvancedSettings = {
  quality?: string | null;
  background?: string | null;
  negativePrompt?: string | null;
  seed?: string | null;
  thinking?: string | null;
};

async function generateForModel(
  model: string,
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
  advanced?: AdvancedSettings,
): Promise<GeneratedImage> {
  switch (model) {
    case "gpt-image-2":
      return generateImageGptImage2(
        userId,
        prompt,
        referenceImageIds,
        resolution,
        aspectRatio,
        advanced,
      );
    case "gpt-5.4-mini":
      return generateImageOpenAIResponses(
        userId,
        prompt,
        referenceImageIds,
        resolution,
        aspectRatio,
        advanced,
      );
    case "gemini-2.5-flash-image":
    case "gemini-3.1-flash-image-preview":
    case "gemini-3-pro-image-preview":
      return generateImageGeminiModel(
        model,
        userId,
        prompt,
        referenceImageIds,
        resolution,
        aspectRatio,
        advanced,
      );
    default:
      throw new Error(`Unsupported model: ${model}`);
  }
}

export const mediaRouter = createTRPCRouter({
  /**
   * Delete a single generated media item. Removes the file from UploadThing (if
   * one was uploaded) and then deletes the database row. Only the owning user
   * may delete.
   */
  deleteMedia: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let fileKey = undefined;
      try {
        fileKey = await db.transaction(async (txn) => {
          const [row] = await txn
            .select()
            .from(media)
            .leftJoin(referenceImages, eq(media.id, referenceImages.reusedFromMediaId))
            .where(and(eq(media.id, input.id), eq(media.userId, ctx.user)))
            .for("update", {of: media})
            .limit(1);

          if (!row) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Media not found",
            });
          }

          await txn
            .delete(media)
            .where(and(eq(media.id, input.id), eq(media.userId, ctx.user)));

          return row.reference?.reusedFromMediaId ? undefined : row.media.key;
        })
      } catch (err) {
        if(err instanceof TRPCError) throw err;
        console.error(`Error deleting media with id ${input.id}`, err);
        return { success: false }
      }

      if (fileKey){
        await utapi.deleteFiles(fileKey).catch((r)=>{
          console.error(
            `Failed to delete media with key ${fileKey} from UploadThing`,
            r
          );
        });
      }
      return { success: true };
    }),


  /**
   * Run the generation for a pending media row (image or video). Resolves the
   * row to either `succeeded` (with url/key) or `failed` (with an error
   * message), and returns the final row. Throws on input/lookup problems and
   * for unimplemented kinds (e.g. video, which currently surfaces a 500).
   */
  runGeneration: protectedProcedure
    .input(
      z.object({
        mediaId: z.string().min(1),
        retry: z.boolean().optional(),
        requestQuotaBypass: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<Media> => {
      console.log("[runGeneration] input:", { mediaId: input.mediaId, retry: input.retry });

      const [mediaRow] = await db
        .select()
        .from(media)
        .where(and(eq(media.id, input.mediaId), eq(media.userId, ctx.user)))
        .limit(1);
      if (!mediaRow) {
        console.error("[runGeneration] media row not found:", input.mediaId);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Media row not found",
        });
      }

      console.log("[runGeneration] media row found:", { status: mediaRow.status, model: mediaRow.model, error: mediaRow.error });

      if (mediaRow.status === "succeeded") {
        console.log("[runGeneration] already succeeded, returning early");
        return signMediaRow(mediaRow);
      }
      if (mediaRow.status === "failed" && !input.retry) {
        console.log("[runGeneration] status=failed but retry not set, returning early");
        return signMediaRow(mediaRow);
      }

      const [promptRow] = await db
        .select({
          text: prompts.text,
          referenceImages: prompts.referenceImages,
          resolution: prompts.resolution,
          aspectRatio: prompts.aspectRatio,
          quality: prompts.quality,
          background: prompts.background,
          negativePrompt: prompts.negativePrompt,
          seed: prompts.seed,
          thinking: prompts.thinking,
        })
        .from(prompts)
        .where(
          and(eq(prompts.id, mediaRow.promptId), eq(prompts.userId, ctx.user)),
        )
        .limit(1);
      if (!promptRow) {
        console.error("[runGeneration] prompt row not found for promptId:", mediaRow.promptId);
        await db
          .update(media)
          .set({ status: "failed", error: "Prompt not found", updatedAt: new Date() })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)));
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const canBypassMonthlyQuota = input.requestQuotaBypass
        ? await currentUserCanBypassLimits()
        : false;

      if (mediaRow.type === "video") {
        if (!isSeedanceSlug(mediaRow.model)) {
          await db
            .update(media)
            .set({
              status: "failed",
              error: `Unknown video model: ${mediaRow.model}`,
              updatedAt: new Date(),
            })
            .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Unknown video model: ${mediaRow.model}`,
          });
        }

        const videoReferenceImageIds = parseReferenceImageIds(
          promptRow.referenceImages,
        );
        let firstFrameImageUrl: string | undefined;
        if (videoReferenceImageIds.length > 0) {
          const refs = await loadOwnedReferenceImages(ctx.user, [
            videoReferenceImageIds[0]!,
          ]);
          firstFrameImageUrl = refs[0]?.url ?? undefined;
        }

        const videoDurationSeconds = mediaRow.durationMs
          ? mediaRow.durationMs / 1000
          : 5;

        const videoClaim = await db.transaction(async (tx) => {
          if (input.retry) {
            await lockUserUsage(tx, ctx.user);
            const usedCredits = await getUsedCredits(tx, ctx.user);
            if (!canBypassMonthlyQuota && usedCredits >= MONTHLY_CREDIT_LIMIT) {
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: "Monthly credit limit reached",
              });
            }
            const [claimed] = await tx
              .update(media)
              .set({ status: "running", error: null, updatedAt: new Date() })
              .where(
                and(
                  eq(media.id, mediaRow.id),
                  eq(media.userId, ctx.user),
                  eq(media.status, "failed"),
                ),
              )
              .returning();
            if (!claimed) return { claimed: null, usageId: undefined };

            const usageRow = await createReservedUsage(tx, {
              userId: ctx.user,
              mediaId: mediaRow.id,
              model: mediaRow.model,
              videoResolution: promptRow.resolution,
              aspectRatio: promptRow.aspectRatio,
              duration: videoDurationSeconds,
              usageType: "video_generation",
            });
            return { claimed, usageId: usageRow.id };
          }

          const [existingUsage] = await tx
            .select({ id: generationUsage.id })
            .from(generationUsage)
            .where(
              and(
                eq(generationUsage.userId, ctx.user),
                eq(generationUsage.mediaId, mediaRow.id),
                eq(generationUsage.status, "reserved"),
              ),
            )
            .orderBy(desc(generationUsage.createdAt))
            .limit(1);

          if (!existingUsage) {
            await lockUserUsage(tx, ctx.user);
            const usedCredits = await getUsedCredits(tx, ctx.user);
            if (!canBypassMonthlyQuota && usedCredits >= MONTHLY_CREDIT_LIMIT) {
              throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: "Monthly credit limit reached",
              });
            }
          }

          const [claimed] = await tx
            .update(media)
            .set({ status: "running", error: null, updatedAt: new Date() })
            .where(
              and(
                eq(media.id, mediaRow.id),
                eq(media.userId, ctx.user),
                eq(media.status, "pending"),
              ),
            )
            .returning();
          if (!claimed) return { claimed: null, usageId: undefined };

          if (existingUsage) return { claimed, usageId: existingUsage.id };

          const usageRow = await createReservedUsage(tx, {
            userId: ctx.user,
            mediaId: mediaRow.id,
            model: mediaRow.model,
            videoResolution: promptRow.resolution,
            aspectRatio: promptRow.aspectRatio,
            duration: videoDurationSeconds,
            usageType: "video_generation",
          });
          return { claimed, usageId: usageRow.id };
        });

        if (!videoClaim.claimed) {
          const [current] = await db
            .select()
            .from(media)
            .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
            .limit(1);
          return signMediaRow(current ?? mediaRow);
        }

        let task;
        try {
          task = await submitSeedanceTask({
            slug: mediaRow.model,
            prompt: promptRow.text,
            duration: videoDurationSeconds,
            aspectRatio: promptRow.aspectRatio ?? "adaptive",
            resolution: promptRow.resolution ?? undefined,
            firstFrameImageUrl,
          });
        } catch (err) {
          console.error("[runGeneration] seedance submit failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          await db
            .update(media)
            .set({
              status: "failed",
              error: message,
              updatedAt: new Date(),
            })
            .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)));
          await markUsageStatus(videoClaim.usageId, "refunded").catch((err2) =>
            console.error("[runGeneration] failed to refund video usage:", err2),
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to submit video task: ${message}`,
          });
        }

        const [updated] = await db
          .update(media)
          .set({
            status: "running",
            providerStatus: task.taskId,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();

        console.log(
          "[runGeneration] video task submitted:",
          task.taskId,
          "for media:",
          mediaRow.id,
        );
        return signMediaRow(updated ?? mediaRow);
      }

      const claimResult = await db.transaction(async (tx) => {
        if (input.retry) {
          await lockUserUsage(tx, ctx.user);
          const usedCredits = await getUsedCredits(tx, ctx.user);
          if (!canBypassMonthlyQuota && usedCredits >= MONTHLY_CREDIT_LIMIT) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Monthly credit limit reached",
            });
          }

          const [claimed] = await tx
            .update(media)
            .set({ status: "running", error: null, updatedAt: new Date() })
            .where(
              and(
                eq(media.id, mediaRow.id),
                eq(media.userId, ctx.user),
                eq(media.status, "failed"),
              ),
            )
            .returning();
          if (!claimed) return { claimed: null, usageId: undefined };

          const usageRow = await createReservedUsage(tx, {
            userId: ctx.user,
            mediaId: mediaRow.id,
            model: mediaRow.model,
            resolution: promptRow.resolution,
            aspectRatio: promptRow.aspectRatio,
          });

          return { claimed, usageId: usageRow.id };
        }

        const [existingUsage] = await tx
          .select({ id: generationUsage.id })
          .from(generationUsage)
          .where(
            and(
              eq(generationUsage.userId, ctx.user),
              eq(generationUsage.mediaId, mediaRow.id),
              eq(generationUsage.status, "reserved"),
            ),
          )
          .orderBy(desc(generationUsage.createdAt))
          .limit(1);

        if (!existingUsage) {
          await lockUserUsage(tx, ctx.user);
          const usedCredits = await getUsedCredits(tx, ctx.user);
          if (!canBypassMonthlyQuota && usedCredits >= MONTHLY_CREDIT_LIMIT) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Monthly credit limit reached",
            });
          }
        }

        const [claimed] = await tx
          .update(media)
          .set({ status: "running", error: null, updatedAt: new Date() })
          .where(
            and(
              eq(media.id, mediaRow.id),
              eq(media.userId, ctx.user),
              eq(media.status, "pending"),
            ),
          )
          .returning();
        if (!claimed) return { claimed: null, usageId: undefined };

        if (existingUsage) {
          return { claimed, usageId: existingUsage.id };
        }

        const usageRow = await createReservedUsage(tx, {
          userId: ctx.user,
          mediaId: mediaRow.id,
          model: mediaRow.model,
          resolution: promptRow.resolution,
          aspectRatio: promptRow.aspectRatio,
        });

        return { claimed, usageId: usageRow.id };
      });

      if (!claimResult.claimed) {
        console.log("[runGeneration] claim failed, another worker claimed it");
        const [current] = await db
          .select()
          .from(media)
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .limit(1);
        return signMediaRow(current ?? mediaRow);
      }

      console.log("[runGeneration] starting generation for model:", mediaRow.model);

      const referenceImageIds = parseReferenceImageIds(
        promptRow.referenceImages,
      );

      try {
        const generated = await generateForModel(
          mediaRow.model,
          ctx.user,
          promptRow.text,
          referenceImageIds,
          promptRow.resolution ?? undefined,
          promptRow.aspectRatio ?? undefined,
          {
            quality: promptRow.quality,
            background: promptRow.background,
            negativePrompt: promptRow.negativePrompt,
            seed: promptRow.seed,
            thinking: promptRow.thinking,
          },
        );
        await recordGenerationCostEvent({
          userId: ctx.user,
          mediaId: mediaRow.id,
          usageId: claimResult.usageId,
          provider: generated.cost.provider,
          providerRequestId: generated.cost.providerRequestId,
          model: mediaRow.model,
          providerModel: generated.cost.providerModel,
          operation: generated.cost.operation,
          usageRaw: generated.cost.usageRaw,
          fallbackContext: {
            resolution: promptRow.resolution,
            aspectRatio: promptRow.aspectRatio,
            outputImageCount: 1,
            ...generated.cost.fallbackContext,
          },
        }).catch((err) => {
          console.error("[runGeneration] failed to record generation cost:", err);
        });
        console.log("[runGeneration] generation succeeded, uploading");
        const { url, key } = await uploadGeneratedImage({
          mediaId: mediaRow.id,
          generated,
        });

        const [updated] = await db
          .update(media)
          .set({
            status: "succeeded",
            url,
            key,
            mimeType: generated.mimeType,
            error: null,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update image row",
          });
        }
        const didConsume = await markUsageStatus(
          claimResult.usageId,
          "consumed",
        ).catch((err) => {
          console.error("[runGeneration] failed to consume usage row:", err);
          return false;
        });
        if (!didConsume) {
          console.warn("[runGeneration] usage row was not consumed");
        }
        await getPostHogClient().captureImmediate({
          distinctId: ctx.user,
          event: "image_generation_succeeded",
          properties: {
            image_id: mediaRow.id,
            model: mediaRow.model,
            provider: generated.cost.provider,
          },
        });
        console.log("[runGeneration] done, status: succeeded");
        return signMediaRow(updated);
      } catch (err) {
        console.error("[runGeneration] generation/upload failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        const [updated] = await db
          .update(media)
          .set({
            status: "failed",
            error: message,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to record image failure",
          });
        }
        const didRefund = await markUsageStatus(
          claimResult.usageId,
          "refunded",
        ).catch((err) => {
          console.error("[runGeneration] failed to refund usage row:", err);
          return false;
        });
        if (!didRefund) {
          console.warn("[runGeneration] usage row was not refunded");
        }
        await getPostHogClient().captureImmediate({
          distinctId: ctx.user,
          event: "image_generation_failed",
          properties: {
            image_id: mediaRow.id,
            model: mediaRow.model,
            error_code: imageGenerationErrorCode(err, message),
            error_snippet: redactErrorMessage(message),
          },
        });
        console.log("[runGeneration] done, status: failed, error:", message);
        return signMediaRow(updated);
      }
    }),

  /**
   * Poll a single in-flight video media row against Modelark. Transitions the
   * row to `succeeded` (downloading + re-uploading the video to UploadThing
   * and recording cost + consuming usage) or `failed` (refunding usage) when
   * Modelark reports a terminal state. Otherwise just bumps `updatedAt`.
   * Image media is rejected; finished rows are returned as-is.
   */
  pollMediaGeneration: protectedProcedure
    .input(z.object({ mediaId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<Media> => {
      const [mediaRow] = await db
        .select()
        .from(media)
        .where(and(eq(media.id, input.mediaId), eq(media.userId, ctx.user)))
        .limit(1);
      if (!mediaRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Media row not found",
        });
      }

      if (mediaRow.type !== "video") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only video media can be polled",
        });
      }

      if (mediaRow.status !== "running" || !mediaRow.providerStatus) {
        return signMediaRow(mediaRow);
      }

      let task;
      try {
        task = await pollSeedanceTask(mediaRow.providerStatus);
      } catch (err) {
        console.error(
          "[pollMediaGeneration] seedance poll error (transient):",
          err,
        );
        return signMediaRow(mediaRow);
      }

      if (task.status === "queued" || task.status === "running") {
        const [updated] = await db
          .update(media)
          .set({ updatedAt: new Date() })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        return signMediaRow(updated ?? mediaRow);
      }

      const refundReservedUsage = async () => {
        const [existingUsage] = await db
          .select({ id: generationUsage.id })
          .from(generationUsage)
          .where(
            and(
              eq(generationUsage.userId, ctx.user),
              eq(generationUsage.mediaId, mediaRow.id),
              eq(generationUsage.status, "reserved"),
            ),
          )
          .orderBy(desc(generationUsage.createdAt))
          .limit(1);
        if (!existingUsage) return;
        await markUsageStatus(existingUsage.id, "refunded").catch((err) =>
          console.error(
            "[pollMediaGeneration] failed to refund video usage:",
            err,
          ),
        );
      };

      if (task.status === "failed" || task.status === "cancelled") {
        const message = task.error?.message ?? `Modelark task ${task.status}`;
        const [updated] = await db
          .update(media)
          .set({
            status: "failed",
            error: message,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        await refundReservedUsage();
        await getPostHogClient().captureImmediate({
          distinctId: ctx.user,
          event: "video_generation_failed",
          properties: {
            media_id: mediaRow.id,
            model: mediaRow.model,
            task_id: task.taskId,
            error_snippet: redactErrorMessage(message),
          },
        });
        return signMediaRow(updated ?? mediaRow);
      }

      // task.status === "succeeded"
      if (!task.videoUrl) {
        const [updated] = await db
          .update(media)
          .set({
            status: "failed",
            error: "Modelark task succeeded but returned no video URL",
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        await refundReservedUsage();
        return signMediaRow(updated ?? mediaRow);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          VIDEO_DOWNLOAD_TIMEOUT_MS,
        );
        let buf: Buffer;
        try {
          const videoResp = await fetch(task.videoUrl, {
            signal: controller.signal,
          });
          if (!videoResp.ok) {
            throw new Error(
              `Failed to download video from Modelark: ${videoResp.status}`,
            );
          }
          buf = Buffer.from(await videoResp.arrayBuffer());
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            throw new Error("Video download timed out");
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
        }

        const file = new UTFile(
          [new Uint8Array(buf)],
          `${mediaRow.id}.mp4`,
          { type: "video/mp4" },
        );
        const uploaded = await utapi.uploadFiles(file, { acl: "private" });
        if (uploaded.error || !uploaded.data) {
          throw new Error(
            `UploadThing upload failed: ${
              uploaded.error?.message ?? "unknown error"
            }`,
          );
        }

        const durationSeconds = mediaRow.durationMs
          ? mediaRow.durationMs / 1000
          : 5;

        const [reservedUsage] = await db
          .select({ id: generationUsage.id })
          .from(generationUsage)
          .where(
            and(
              eq(generationUsage.userId, ctx.user),
              eq(generationUsage.mediaId, mediaRow.id),
              eq(generationUsage.status, "reserved"),
            ),
          )
          .orderBy(desc(generationUsage.createdAt))
          .limit(1);

        await recordGenerationCostEvent({
          userId: ctx.user,
          mediaId: mediaRow.id,
          usageId: reservedUsage?.id,
          provider: "modelark",
          providerRequestId: task.taskId,
          model: mediaRow.model,
          providerModel: task.providerModel || null,
          operation: "video_generation",
          usageRaw: task.usageRaw,
          fallbackContext: {
            duration: durationSeconds,
          },
        }).catch((err) =>
          console.error(
            "[pollMediaGeneration] failed to record video cost:",
            err,
          ),
        );

        const [updated] = await db
          .update(media)
          .set({
            status: "succeeded",
            url: uploaded.data.ufsUrl,
            key: uploaded.data.key,
            mimeType: "video/mp4",
            error: null,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();

        if (reservedUsage) {
          await markUsageStatus(reservedUsage.id, "consumed").catch((err) =>
            console.error(
              "[pollMediaGeneration] failed to consume video usage:",
              err,
            ),
          );
        }

        await getPostHogClient().captureImmediate({
          distinctId: ctx.user,
          event: "video_generation_succeeded",
          properties: {
            media_id: mediaRow.id,
            model: mediaRow.model,
            task_id: task.taskId,
            provider: "modelark",
          },
        });

        return signMediaRow(updated ?? mediaRow);
      } catch (err) {
        console.error("[pollMediaGeneration] finalization failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        const [updated] = await db
          .update(media)
          .set({
            status: "failed",
            error: message,
            updatedAt: new Date(),
          })
          .where(and(eq(media.id, mediaRow.id), eq(media.userId, ctx.user)))
          .returning();
        await refundReservedUsage();
        return signMediaRow(updated ?? mediaRow);
      }
    }),
});
