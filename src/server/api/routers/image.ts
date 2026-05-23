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
  images,
  prompts,
  referenceImages,
  type GenerationCostEventOperation,
  type Image,
  type ReferenceImage,
} from "src/server/db/schema";
import { recordGenerationCostEvent } from "src/server/generation-costs";
import { currentUserCanBypassLimits } from "src/server/limits";
import { utapi, UTFile } from "src/server/uploadthing";
import {
  createReservedUsage,
  getUsedCredits,
  lockUserUsage,
  markUsageStatus,
} from "src/server/usage";

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
  };
};

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

function parseReferenceImageIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
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

  return ownedReferenceImages;
}

async function generateImageOpenAIResponses(
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
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

  const body = JSON.stringify({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: [...modelInputs],
      },
    ],
    tools: [{ type: "image_generation", size, output_format: "png" }],
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
    },
  };
}

async function generateImageGptImage2Generations(
  prompt: string,
  model: ["gpt-image-2-2026-04-21"][number],
  size: string,
) : Promise<GeneratedImage | undefined> {
  const body =
      JSON.stringify({
        model,
        prompt,
        size,
        output_format: "png",
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
    },
  };
}

async function generateImageGptImage2Edits(
  prompt: string,
  size: string,
  referenceImages: ReferenceImage[],
) : Promise<GeneratedImage | undefined> {
  const body =
      JSON.stringify({
        model: "gpt-image-2-2026-04-21",
        prompt,
        images: referenceImages.map((image) => ({
          image_url: image.url,
        })),
        size,
        output_format: "png",
      })
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
    },
  };
}

async function generateImageGptImage2(
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const ownedReferenceImages = await loadOwnedReferenceImages(
    userId,
    referenceImageIds,
  );
  const size = resolveImageSize(resolution, aspectRatio) ?? "auto";

  const image = await (
    ownedReferenceImages.length > 0 ?
      generateImageGptImage2Edits(prompt, size, ownedReferenceImages) :
      generateImageGptImage2Generations(prompt, "gpt-image-2-2026-04-21", size)
  );

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
  const modelInputs = [
    ...referenceImageInputs.map((image) => ({
      inline_data: {
        mime_type: image.mimeType,
        data: image.b64,
      },
    })),
    { text: "Generate an image based on the following user input:" + prompt },
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

  requestBody.generationConfig = {
    responseModalities: ["IMAGE"],
    ...((imageSize != null || aspectRatio != null) && {
      imageConfig: {
        ...(imageSize && { imageSize }),
        ...(aspectRatio && { aspectRatio }),
      },
    }),
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
  imageId: string;
  generated: GeneratedImage;
}): Promise<{ url: string; key: string }> {
  const ext = extensionFor(args.generated.mimeType);
  const file = new UTFile(
    [base64ToBytes(args.generated.base64)],
    `${args.imageId}.${ext}`,
    { type: args.generated.mimeType },
  );

  const uploaded = await utapi.uploadFiles(file);

  if (uploaded.error || !uploaded.data) {
    throw new Error(
      `UploadThing upload failed: ${uploaded.error?.message ?? "unknown error"}`,
    );
  }

  return { url: uploaded.data.ufsUrl, key: uploaded.data.key };
}

async function generateForModel(
  model: string,
  userId: string,
  prompt: string,
  referenceImageIds?: string[],
  resolution?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  switch (model) {
    case "gpt-image-2":
      return generateImageGptImage2(
        userId,
        prompt,
        referenceImageIds,
        resolution,
        aspectRatio,
      );
    case "gpt-5.4-mini":
      return generateImageOpenAIResponses(
        userId,
        prompt,
        referenceImageIds,
        resolution,
        aspectRatio,
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
      );
    default:
      throw new Error(`Unsupported model: ${model}`);
  }
}

export const imageRouter = createTRPCRouter({
  /**
   * Delete a single generated image. Removes the file from UploadThing (if
   * one was uploaded) and then deletes the database row. Only the owning
   * user may delete.
   */
  deleteImage: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let fileKey = undefined;
      try {
        fileKey = await db.transaction(async (txn) => {
          const [row] = await txn
            .select()
            .from(images)
            .leftJoin(referenceImages, eq(images.id, referenceImages.reusedFrom))
            .where(and(eq(images.id, input.id), eq(images.userId, ctx.user)))
            .for("update", {of: images})
            .limit(1);

          if (!row) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Image not found",
            });
          }

          await txn
            .delete(images)
            .where(and(eq(images.id, input.id), eq(images.userId, ctx.user)));

          return row.reference?.reusedFrom ? undefined : row.image.key;
        })
      } catch (err) {
        if(err instanceof TRPCError) throw err;
        console.error(`Error deleting image with id ${input.id}`, err);
        return { success: false }
      }

      if (fileKey){
        await utapi.deleteFiles(fileKey).catch((r)=>{
          console.error(
            `Failed to delete image with key ${fileKey} from UploadThing`,
            r
          );
        });
      }
      return { success: true };
    }),


  /**
   * Run the generation for a pending image row. Resolves the row to either
   * `succeeded` (with url/key) or `failed` (with an error message). Always
   * returns the final row; only throws on input/lookup problems.
   */
  runGeneration: protectedProcedure
    .input(
      z.object({
        imageId: z.string().min(1),
        retry: z.boolean().optional(),
        requestQuotaBypass: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<Image> => {
      console.log("[runGeneration] input:", { imageId: input.imageId, retry: input.retry });

      const [imageRow] = await db
        .select()
        .from(images)
        .where(and(eq(images.id, input.imageId), eq(images.userId, ctx.user)))
        .limit(1);
      if (!imageRow) {
        console.error("[runGeneration] image row not found:", input.imageId);
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Image row not found",
        });
      }

      console.log("[runGeneration] image row found:", { status: imageRow.status, model: imageRow.model, error: imageRow.error });

      if (imageRow.status === "succeeded") {
        console.log("[runGeneration] already succeeded, returning early");
        return imageRow;
      }
      if (imageRow.status === "failed" && !input.retry) {
        console.log("[runGeneration] status=failed but retry not set, returning early");
        return imageRow;
      }

      const [promptRow] = await db
        .select({
          text: prompts.text,
          referenceImages: prompts.referenceImages,
          resolution: prompts.resolution,
          aspectRatio: prompts.aspectRatio,
        })
        .from(prompts)
        .where(
          and(eq(prompts.id, imageRow.promptId), eq(prompts.userId, ctx.user)),
        )
        .limit(1);
      if (!promptRow) {
        console.error("[runGeneration] prompt row not found for promptId:", imageRow.promptId);
        await db
          .update(images)
          .set({ status: "failed", error: "Prompt not found", updatedAt: new Date() })
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)));
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const canBypassMonthlyQuota = input.requestQuotaBypass
        ? await currentUserCanBypassLimits()
        : false;

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
            .update(images)
            .set({ status: "running", error: null, updatedAt: new Date() })
            .where(
              and(
                eq(images.id, imageRow.id),
                eq(images.userId, ctx.user),
                eq(images.status, "failed"),
              ),
            )
            .returning();
          if (!claimed) return { claimed: null, usageId: undefined };

          const usageRow = await createReservedUsage(tx, {
            userId: ctx.user,
            imageId: imageRow.id,
            model: imageRow.model,
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
              eq(generationUsage.imageId, imageRow.id),
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
          .update(images)
          .set({ status: "running", error: null, updatedAt: new Date() })
          .where(
            and(
              eq(images.id, imageRow.id),
              eq(images.userId, ctx.user),
              eq(images.status, "pending"),
            ),
          )
          .returning();
        if (!claimed) return { claimed: null, usageId: undefined };

        if (existingUsage) {
          return { claimed, usageId: existingUsage.id };
        }

        const usageRow = await createReservedUsage(tx, {
          userId: ctx.user,
          imageId: imageRow.id,
          model: imageRow.model,
          resolution: promptRow.resolution,
          aspectRatio: promptRow.aspectRatio,
        });

        return { claimed, usageId: usageRow.id };
      });

      if (!claimResult.claimed) {
        console.log("[runGeneration] claim failed, another worker claimed it");
        const [current] = await db
          .select()
          .from(images)
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)))
          .limit(1);
        return current ?? imageRow;
      }

      console.log("[runGeneration] starting generation for model:", imageRow.model);

      const referenceImageIds = parseReferenceImageIds(
        promptRow.referenceImages,
      );

      try {
        const generated = await generateForModel(
          imageRow.model,
          ctx.user,
          promptRow.text,
          referenceImageIds,
          promptRow.resolution ?? undefined,
          promptRow.aspectRatio ?? undefined,
        );
        await recordGenerationCostEvent({
          userId: ctx.user,
          imageId: imageRow.id,
          provider: generated.cost.provider,
          providerRequestId: generated.cost.providerRequestId,
          model: imageRow.model,
          providerModel: generated.cost.providerModel,
          operation: generated.cost.operation,
          usageRaw: generated.cost.usageRaw,
          fallbackContext: {
            resolution: promptRow.resolution,
            aspectRatio: promptRow.aspectRatio,
            outputImageCount: 1,
          },
        }).catch((err) => {
          console.error("[runGeneration] failed to record generation cost:", err);
        });
        console.log("[runGeneration] generation succeeded, uploading");
        const { url, key } = await uploadGeneratedImage({
          imageId: imageRow.id,
          generated,
        });

        const [updated] = await db
          .update(images)
          .set({
            status: "succeeded",
            url,
            key,
            mimeType: generated.mimeType,
            error: null,
            updatedAt: new Date(),
          })
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)))
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
        console.log("[runGeneration] done, status: succeeded");
        return updated;
      } catch (err) {
        console.error("[runGeneration] generation/upload failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        const [updated] = await db
          .update(images)
          .set({
            status: "failed",
            error: message,
            updatedAt: new Date(),
          })
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)))
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
        console.log("[runGeneration] done, status: failed, error:", message);
        return updated;
      }
    }),
});
