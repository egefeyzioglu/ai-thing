import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, prompts, type Image } from "src/server/db/schema";
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

async function generateImageOpenAI(prompt: string): Promise<GeneratedImage> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: prompt,
      tools: [{ type: "image_generation" }],
    }),
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

async function generateImageGemini(prompt: string): Promise<GeneratedImage> {
  // "Nano Banana" = gemini-2.5-flash-image, Google's image-gen Gemini variant.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
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
  prompt: string,
): Promise<GeneratedImage> {
  switch (model) {
    case "gpt-5.4-mini":
      return generateImageOpenAI(prompt);
    case "gemini-2.5-flash-image":
      return generateImageGemini(prompt);
    default:
      throw new Error(`Unsupported model: ${model}`);
  }
}

export const imageRouter = createTRPCRouter({
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
    .mutation(async ({ input }): Promise<Image> => {
      const [imageRow] = await db
        .select()
        .from(images)
        .where(eq(images.id, input.imageId))
        .limit(1);
      if (!imageRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Image row not found",
        });
      }

      // Idempotent for completed rows. For failed rows, retry only if
      // the caller explicitly opts in.
      if (imageRow.status === "succeeded") return imageRow;
      if (imageRow.status === "failed") {
        if (!input.retry) return imageRow;
        // Reset to pending so the row reflects the in-flight retry.
        await db
          .update(images)
          .set({ status: "pending", error: null, updatedAt: new Date() })
          .where(eq(images.id, imageRow.id));
      }

      const [promptRow] = await db
        .select({ text: prompts.text })
        .from(prompts)
        .where(eq(prompts.id, imageRow.promptId))
        .limit(1);
      if (!promptRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      try {
        const generated = await generateForModel(
          imageRow.model,
          promptRow.text,
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
          .where(eq(images.id, imageRow.id))
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
          .where(eq(images.id, imageRow.id))
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
