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

type OpenAIResponseOutput =
  | {
      type?: string;
      content?: OpenAIResponseContent[];
    }
  | {
      type: "function_call";
      arguments: string;
      call_id: string;
      id: string;
      name: "suggest_prompt";
      status: string;
    };

type OpenAIResponse = {
  output_text?: string;
  output?: OpenAIResponseOutput[];
};

type GeminiResponsePart = {
  text?: string;
  functionCall?: {
    id: string;
    name: "suggest_prompt";
    args: unknown;
  };
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: GeminiResponsePart[];
    };
  }[];
};

const suggestedPromptParamSchema = z.object({
  prompt: z.string(),
});

type SuggestedPromptParam = z.infer<typeof suggestedPromptParamSchema>;

type ParsedTextResponse = {
  text: string;
  suggestedPromptParam?: SuggestedPromptParam;
};

const workshopSystemPrompt = `## Role

You are an expert image generation prompt engineer. Your goal is to help
users craft detailed, effective prompts for AI image generators like
Nano Banana, OpenAI Image, etc.

## Behavior

- Engage the user in a back-and-forth conversation to understand their
  vision before suggesting a prompt.
- Ask focused, targeted questions to uncover missing details. Do not
  bombard the user with too many questions at once — pick the most
  important 1–2 gaps to address at a time.
- Build a mental model of what the user wants before committing to a
  prompt suggestion.
- Only call \`suggest_prompt\` once you have a reasonable understanding of
  the user's intent. Don't rush — a few exchanges is usually ideal.

## Prompt Crafting Guidelines

When you are ready to suggest a prompt:

- Write in a descriptive, comma-separated or flowing style suited to the
  target model.
- Lead with the most important subject/concept.
- Layer in style, mood, lighting, and technical quality keywords naturally.
- Avoid vague filler words. Be specific and visual.
- Include relevant quality boosters where appropriate (e.g.
  "highly detailed", "cinematic lighting", "8k", "award-winning
  photography") but don't overload the prompt with them.
- Call the \`suggest_prompt\` tool with the final crafted prompt string.

## Tone

Be collaborative, enthusiastic, and creative. You're a creative partner,
not just a form to fill out. If the user seems unsure, offer ideas or
examples to spark their imagination.`;

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

function parseOpenAIResponse(data: OpenAIResponse): ParsedTextResponse {
  if (!data.output) {
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return { text: data.output_text };
    }

    throw new Error("OpenAI response did not contain output or output_text");
  }

  const functionCallParams = data.output
    .filter((item) => item.type === "function_call")
    .map((content) => {
      if (!("arguments" in content)) return undefined;

      const parsedArguments: unknown = JSON.parse(content.arguments);
      return suggestedPromptParamSchema.parse(parsedArguments);
    })
    .filter((e) => e !== undefined);

  const outputText = data.output
    .flatMap((item) => ("content" in item ? (item.content ?? []) : []))
    .filter((content) => content.type === "output_text" || content.text)
    .map((content) => content.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();
  const text =
    outputText.length > 0 ? outputText : (data.output_text?.trim() ?? "");

  if (!text && functionCallParams.length === 0) {
    throw new Error(
      "OpenAI response did not contain any text or a function call",
    );
  }

  return {
    text,
    suggestedPromptParam: functionCallParams[0],
  };
}

function parseSuggestedPromptArgs(
  args: unknown,
): SuggestedPromptParam | undefined {
  let parsedArgs = args;

  if (typeof args === "string") {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      console.warn("[parseGeminiResponse] invalid function call JSON");
      return undefined;
    }
  }

  const result = suggestedPromptParamSchema.safeParse(parsedArgs);
  if (!result.success) {
    console.warn("[parseGeminiResponse] invalid function call args");
    return undefined;
  }

  return result.data;
}

function parseGeminiResponse(data: GeminiResponse): ParsedTextResponse {
  if (data.candidates?.[0]?.content?.parts === undefined) {
    throw new Error(
      "Unrecognized Gemini response shape, or responses did not contain any candidates",
    );
  }

  const functionCallParams = data.candidates[0].content.parts
    .map((part) =>
      part.functionCall
        ? parseSuggestedPromptArgs(part.functionCall.args)
        : undefined,
    )
    .filter((e): e is SuggestedPromptParam => e !== undefined);

  const text = data.candidates[0].content.parts
    .map((part) => part.text)
    .filter((value): value is string => typeof value === "string")
    .join("")
    .trim();

  if (!text && functionCallParams.length === 0) {
    throw new Error(
      "Gemini response did not contain any text or a function call",
    );
  }
  return { text, suggestedPromptParam: functionCallParams[0] };
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
      instructions: workshopSystemPrompt,
      input: messages.map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
      })),
      tools: [
        {
          name: "suggest_prompt",
          description:
            "Suggest a final prompt to be submitted to the image generation model",
          type: "function",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "The prompt you are suggesting",
              },
            },
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  return parseOpenAIResponse((await res.json()) as OpenAIResponse);
}

async function generateGeminiText(messages: ChatMessage[]) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: workshopSystemPrompt }],
        },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        tools: [
          {
            functionDeclarations: [
              {
                name: "suggest_prompt",
                description:
                  "Suggest a final prompt to be submitted to the image generation model",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: {
                      type: "string",
                      description: "The prompt you are suggesting",
                    },
                  },
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }

  return parseGeminiResponse((await res.json()) as GeminiResponse);
}

async function generateAssistantText(
  model: WorkshopModel,
  messages: ChatMessage[],
) {
  switch (model) {
    case "gpt-5.4-mini": {
      const { text, suggestedPromptParam } = await generateOpenAIText(messages);
      if (!suggestedPromptParam) return { assistantText: text };
      return {
        assistantText: text || undefined,
        suggestedPrompt: suggestedPromptParam.prompt,
      };
    }

    case "gemini-3-flash-preview": {
      const { text, suggestedPromptParam } = await generateGeminiText(messages);
      if (!suggestedPromptParam) return { assistantText: text };
      return {
        assistantText: text || undefined,
        suggestedPrompt: suggestedPromptParam.prompt,
      };
    }
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

      let assistantText: string | undefined;
      let suggestedPrompt: string | undefined;
      try {
        ({ assistantText, suggestedPrompt } = await generateAssistantText(
          input.model,
          [...previousMessages, userMessage],
        ));
      } catch (error) {
        console.error("[workshop.sendMessage] provider request failed", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate assistant response",
        });
      }

      if (assistantText === undefined && suggestedPrompt === undefined) {
        console.error(
          "[workshop.sendMessage] got empty response from provider",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Got empty response from provider",
        });
      }

      const insertedAssistantMessages = await db
        .insert(workshopMessages)
        .values([
          ...(assistantText !== undefined
            ? [
                {
                  id: crypto.randomUUID(),
                  userId: ctx.user,
                  projectId: input.projectId,
                  model: input.model,
                  role: "assistant" as const,
                  content: assistantText,
                },
              ]
            : []),
          ...(suggestedPrompt !== undefined
            ? [
                {
                  id: crypto.randomUUID(),
                  userId: ctx.user,
                  projectId: input.projectId,
                  model: input.model,
                  role: "suggest_prompt" as const,
                  content: suggestedPrompt,
                },
              ]
            : []),
        ])
        .returning();

      if (insertedAssistantMessages.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save assistant response",
        });
      }

      return {
        userMessage,
        assistantMessages: insertedAssistantMessages,
        suggestedPrompt,
      };
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
