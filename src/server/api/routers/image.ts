import { TRPCError } from "@trpc/server";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
import { createTRPCRouter, publicProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import { images, type Image } from "src/server/db/schema";
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

async function generateCatOtterImage(prompt: string): Promise<GeneratedImage> {
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
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `OpenAI API error (${res.status}): ${text}`,
    });
  }

  const data = (await res.json()) as ResponsesApiResponse;

  const imageCall = data.output?.find(
    (item) => item.type === "image_generation_call" && item.result,
  );

  if (!imageCall?.result) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "OpenAI response did not contain an image",
    });
  }

  return { base64: imageCall.result, mimeType: "image/png" };
}

async function generateCatOtterImageNanoBanana(
  prompt: string,
): Promise<GeneratedImage> {
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
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Gemini API error (${res.status}): ${text}`,
    });
  }

  const data = (await res.json()) as GeminiResponse;

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inline = parts
    .map((p) => p.inlineData ?? p.inline_data)
    .find((d): d is GeminiInlineData => !!d?.data);

  if (!inline?.data) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Gemini response did not contain an image",
    });
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

async function persistImage(args: {
  generated: GeneratedImage;
  prompt: string;
  model: string;
}): Promise<Image> {
  const id = crypto.randomUUID();
  const ext = extensionFor(args.generated.mimeType);
  const file = new UTFile(
    [base64ToBytes(args.generated.base64)],
    `${id}.${ext}`,
    { type: args.generated.mimeType },
  );

  const uploaded = await utapi.uploadFiles(file);

  if (uploaded.error || !uploaded.data) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `UploadThing upload failed: ${uploaded.error?.message ?? "unknown error"}`,
    });
  }

  const [row] = await db
    .insert(images)
    .values({
      id,
      url: uploaded.data.ufsUrl,
      key: uploaded.data.key,
      prompt: args.prompt,
      model: args.model,
    })
    .returning();

  if (!row) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to insert image row",
    });
  }

  return row;
}

export const imageRouter = createTRPCRouter({
  list: publicProcedure.query(async () => {
    return db.select().from(images).orderBy(desc(images.createdAt));
  }),

  catOtter: publicProcedure
    .input(z.object({ prompt: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const generated = await generateCatOtterImage(input.prompt);
      return persistImage({
        generated,
        prompt: input.prompt,
        model: "gpt-5.4-mini",
      });
    }),

  catOtterNanoBanana: publicProcedure
    .input(z.object({ prompt: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      const generated = await generateCatOtterImageNanoBanana(input.prompt);
      return persistImage({
        generated,
        prompt: input.prompt,
        model: "gemini-2.5-flash-image",
      });
    }),
});
