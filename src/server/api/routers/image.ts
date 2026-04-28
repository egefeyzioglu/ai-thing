import { TRPCError } from "@trpc/server";

import { env } from "src/env";
import { createTRPCRouter, publicProcedure } from "src/server/api/trpc";

import { z } from "zod"

const PROMPT =
  "Generate an image of gray tabby cat hugging an otter with an orange scarf";

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

/**
 * Module-level caches. The first caller for each provider kicks off the
 * request; every subsequent caller awaits the same promise, so each image is
 * generated exactly once per server process.
 */
let cachedOpenAIImage: Promise<string> | null = null;
let cachedNanoBananaImage: Promise<string> | null = null;

async function generateCatOtterImage(prompt: string): Promise<string> {
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

  return `data:image/png;base64,${imageCall.result}`;
}

async function generateCatOtterImageNanoBanana(prompt: string): Promise<string> {
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

  const mime = inline.mimeType ?? "image/png";
  return `data:${mime};base64,${inline.data}`;
}

export const imageRouter = createTRPCRouter({
  catOtter: publicProcedure.input(z.object({ prompt: z.string().min(1).max(1000) }))
    .query(async ({ input }) => {
      const image = generateCatOtterImage(input.prompt).catch((err) => {
        throw err;
      });

      const dataUrl = await image;
      return { dataUrl, prompt: input};
    }),

  catOtterNanoBanana: publicProcedure.input(z.object({ prompt: z.string().min(1).max(1000) }))
  .query(async ({ input }) => {
    const image = generateCatOtterImageNanoBanana(input.prompt).catch((err) => {
      throw err;
    });

    const dataUrl = await image;
    return { dataUrl, prompt: input};
  }),
});
