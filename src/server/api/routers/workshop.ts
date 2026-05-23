import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  projects,
  workshopMessages,
  type WorkshopMessage,
} from "src/server/db/schema";

const WORKSHOP_MODELS = ["gpt-5.4-mini", "gemini-3-flash-preview"] as const;
type WorkshopModel = (typeof WORKSHOP_MODELS)[number];

type ChatMessage = Pick<WorkshopMessage, "role" | "content">;

type OpenAIResponseContent = {
  type?: string;
  text?: string;
};

type OpenAIResponseOutput = {
  type?: string;
  content?: OpenAIResponseContent[];
};

type OpenAIResponse = {
  output_text?: string;
  output?: OpenAIResponseOutput[];
};

type GeminiTextPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: GeminiTextPart[];
    };
  }[];
};

async function verifyProjectOwnership(userId: string, projectId: string) {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }
}

function parseOpenAIText(data: OpenAIResponse) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const text = data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" || content.text)
    .map((content) => content.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

  if (!text) throw new Error("OpenAI response did not contain text");
  return text;
}

function parseGeminiText(data: GeminiResponse) {
  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .filter((value): value is string => typeof value === "string")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini response did not contain text");
  return text;
}

async function generateOpenAIText(messages: ChatMessage[]) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  return parseOpenAIText((await res.json()) as OpenAIResponse);
}

async function generateGeminiText(messages: ChatMessage[]) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  return parseGeminiText((await res.json()) as GeminiResponse);
}

async function generateAssistantText(
  model: WorkshopModel,
  messages: ChatMessage[],
) {
  switch (model) {
    case "gpt-5.4-mini":
      return generateOpenAIText(messages);
    case "gemini-3-flash-preview":
      return generateGeminiText(messages);
  }
}

export const workshopRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await verifyProjectOwnership(ctx.user, input.projectId);

      return db
        .select()
        .from(workshopMessages)
        .where(
          and(
            eq(workshopMessages.userId, ctx.user),
            eq(workshopMessages.projectId, input.projectId),
          ),
        )
        .orderBy(asc(workshopMessages.createdAt));
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        content: z.string().trim().min(1).max(20_000),
        model: z.enum(WORKSHOP_MODELS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyProjectOwnership(ctx.user, input.projectId);

      const previousMessages = await db
        .select()
        .from(workshopMessages)
        .where(
          and(
            eq(workshopMessages.userId, ctx.user),
            eq(workshopMessages.projectId, input.projectId),
          ),
        )
        .orderBy(asc(workshopMessages.createdAt));

      const [userMessage] = await db
        .insert(workshopMessages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          projectId: input.projectId,
          role: "user",
          model: null,
          content: input.content,
        })
        .returning();

      if (!userMessage) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save message",
        });
      }

      let assistantText: string;
      try {
        assistantText = await generateAssistantText(input.model, [
          ...previousMessages,
          userMessage,
        ]);
      } catch (error) {
        console.error("[workshop.sendMessage] provider request failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate assistant response",
        });
      }

      const [assistantMessage] = await db
        .insert(workshopMessages)
        .values({
          id: crypto.randomUUID(),
          userId: ctx.user,
          projectId: input.projectId,
          role: "assistant",
          model: input.model,
          content: assistantText,
        })
        .returning();

      if (!assistantMessage) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save assistant response",
        });
      }

      return { userMessage, assistantMessage };
    }),

  clear: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyProjectOwnership(ctx.user, input.projectId);

      await db
        .delete(workshopMessages)
        .where(
          and(
            eq(workshopMessages.userId, ctx.user),
            eq(workshopMessages.projectId, input.projectId),
          ),
        );

      return { success: true };
    }),
});
