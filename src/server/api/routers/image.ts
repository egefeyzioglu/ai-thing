import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { extensionFor } from "src/lib/utils";

import { env } from "src/env";
import { captureServerException } from "src/lib/server-utils";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  images,
  prompts,
  referenceImages,
  type Image,
  type ReferenceImage,
} from "src/server/db/schema";
import { utapi, UTFile } from "src/server/uploadthing";

type ResponsesApiOutputItem = {
  type: string;
  result?: string;
  status?: string;
};

type ResponsesApiResponse = {
  output?: ResponsesApiOutputItem[];
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

type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string };
};

type GeneratedImage = {
  base64: string;
  mimeType: string;
};

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

async function generateImageOpenAI(
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

  // OpenAI only supports 1024x1024, 1024x1536, 1536x1024, and auto.
  // Map aspect ratio to the closest supported size; ignore raw resolution.
  let size = "auto";
  if (aspectRatio) {
    const parts = aspectRatio.split(":").map(Number);
    const w = parts[0];
    const h = parts[1];
    if (w && h) {
      const ratio = w / h;
      if (ratio >= 0.99 && ratio <= 1.01) {
        size = "1024x1024";
      } else if (ratio > 1) {
        size = "1536x1024";
      } else {
        size = "1024x1536";
      }
    }
  }

  const body = JSON.stringify({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: [...modelInputs],
      },
    ],
    tools: [{ type: "image_generation", size }],
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

  return { base64: imageCall.result, mimeType: "image/png" };
}

async function generateImageGemini(
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
  const referenceImageB64s = (
    await Promise.all(
      ownedReferenceImages.map(async (image) => {
        if (!image?.url) return undefined;
        const imageBytes = await (await fetch(image.url)).bytes();
        return Buffer.from(imageBytes).toString("base64");
      }),
    )
  ).filter((x): x is string => x !== undefined);
  const modelInputs = [
    ...referenceImageB64s.map((b64: string) => ({
      inline_data: {
        // TODO: Don't hardcode the mime type
        mime_type: "image/png",
        data: b64,
      },
    })),
    { text: "Generate an image based on the following user input:" + prompt },
  ];
  // "Nano Banana" = gemini-2.5-flash-image, Google's image-gen Gemini variant.

  // Map resolution to Gemini imageSize
  let imageSize: string | undefined;
  if (resolution) {
    const res = parseInt(resolution, 10);
    if (res <= 512) imageSize = "512";
    else if (res <= 1024) imageSize = "1K";
    else if (res <= 2048) imageSize = "2K";
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
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

  return { base64: inline.data, mimeType: inline.mimeType ?? "image/png" };
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
    case "gpt-5.4-mini":
      return generateImageOpenAI(userId, prompt, referenceImageIds, resolution, aspectRatio);
    case "gemini-2.5-flash-image":
      return generateImageGemini(userId, prompt, referenceImageIds, resolution, aspectRatio);
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
        await captureServerException(err, {
          source: "image.deleteImage.transaction",
          imageId: input.id,
          userId: ctx.user,
        }, ctx.user);
        console.error(`Error deleting image with id ${input.id}`, err);
        return { success: false }
      }

      if (fileKey){
        await utapi.deleteFiles(fileKey).catch(async (r)=>{
          await captureServerException(r, {
            source: "image.deleteImage.deleteUploadThingFile",
            imageId: input.id,
            fileKey,
            userId: ctx.user,
          }, ctx.user);
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

      // Atomic claim: only proceed if we can transition from the expected
      // status to "running". This prevents duplicate generation if the same
      // image is requested concurrently.
      const claimableStatus = imageRow.status === "failed" ? "failed" : "pending";
      const [claimed] = await db
        .update(images)
        .set({ status: "running", error: null, updatedAt: new Date() })
        .where(
          and(
            eq(images.id, imageRow.id),
            eq(images.userId, ctx.user),
            eq(images.status, claimableStatus),
          ),
        )
        .returning();
      if (!claimed) {
        console.log("[runGeneration] claim failed, another worker claimed it");
        const [current] = await db
          .select()
          .from(images)
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)))
          .limit(1);
        return current ?? imageRow;
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
        console.log("[runGeneration] done, status: succeeded");
        return updated;
      } catch (err) {
        await captureServerException(err, {
          source: "image.runGeneration",
          imageId: input.imageId,
          model: imageRow.model,
          userId: ctx.user,
        }, ctx.user);
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
        console.log("[runGeneration] done, status: failed, error:", message);
        return updated;
      }
    }),
});
