import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
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

  const body = JSON.stringify({
    model: "gpt-5.4-mini",
    input: [
      {
        role: "user",
        content: [...modelInputs],
      },
    ],
    tools: [{ type: "image_generation" }],
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
  ).filter((x?: string) => x !== undefined);
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
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [...modelInputs] }],
      }),
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

function extensionFor(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
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
): Promise<GeneratedImage> {
  switch (model) {
    case "gpt-5.4-mini":
      return generateImageOpenAI(userId, prompt, referenceImageIds);
    case "gemini-2.5-flash-image":
      return generateImageGemini(userId, prompt, referenceImageIds);
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
      const [row] = await db
        .select()
        .from(images)
        .leftJoin(referenceImages, eq(images.id, referenceImages.reusedFrom))
        .where(and(eq(images.id, input.id), eq(images.userId, ctx.user)))
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Image not found",
        });
      }

      if (row.image.key && !row.reference?.reusedFrom) {
        utapi.deleteFiles(row.image.key).catch((r)=>{
          console.error(`Failed to delete image with key ${row.image.key} from UploadThing`)
        });
      }

      await db
        .delete(images)
        .where(and(eq(images.id, input.id), eq(images.userId, ctx.user)));

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
      const [imageRow] = await db
        .select()
        .from(images)
        .where(and(eq(images.id, input.imageId), eq(images.userId, ctx.user)))
        .limit(1);
      if (!imageRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Image row not found",
        });
      }

      // Idempotent for completed rows. For failed rows, only re-run if
      // the caller explicitly opts in via `retry`. Pending rows normally
      // proceed straight to generation, but `retry: true` is also honored
      // there to let the client recover orphaned rows (e.g. ones whose
      // original handler died because the server restarted mid-flight).
      if (imageRow.status === "succeeded") return imageRow;
      if (imageRow.status === "failed" && !input.retry) return imageRow;
      if (imageRow.status === "failed" || input.retry) {
        // Reset to pending so the row reflects the in-flight (re-)run.
        await db
          .update(images)
          .set({ status: "pending", error: null, updatedAt: new Date() })
          .where(and(eq(images.id, imageRow.id), eq(images.userId, ctx.user)));
      }

      const [promptRow] = await db
        .select({
          text: prompts.text,
          referenceImages: prompts.referenceImages,
        })
        .from(prompts)
        .where(
          and(eq(prompts.id, imageRow.promptId), eq(prompts.userId, ctx.user)),
        )
        .limit(1);
      if (!promptRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const referenceImageIds = parseReferenceImageIds(
        promptRow.referenceImages,
      );

      try {
        const generated = await generateForModel(
          imageRow.model,
          ctx.user,
          promptRow.text,
          referenceImageIds,
        );
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
        return updated;
      } catch (err) {
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
        return updated;
      }
    }),
});
