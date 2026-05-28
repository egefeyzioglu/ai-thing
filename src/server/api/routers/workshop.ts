import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
import { MONTHLY_CREDIT_LIMIT } from "src/lib/credits";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  projects,
  workshopMessages,
  workshopThreads,
  type WorkshopMessage,
  type WorkshopThread,
} from "src/server/db/schema";
import { recordGenerationCostEvent } from "src/server/generation-costs";
import {
  createReservedUsage,
  getUsedCredits,
  lockUserUsage,
  markUsageStatus,
} from "src/server/usage";

const WORKSHOP_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.5",
] as const;
type WorkshopModel = (typeof WORKSHOP_MODELS)[number];
type OpenAIWorkshopModel = WorkshopModel;
const WORKSHOP_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type WorkshopReasoningEffort = (typeof WORKSHOP_REASONING_EFFORTS)[number];
const WORKSHOP_MESSAGE_CREDITS = 1;
const DEFAULT_THREAD_TITLE = "New workshop thread";

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
      type: "reasoning";
      summary?: {
        type?: string;
        text?: string;
      }[];
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
  id?: string;
  output_text?: string;
  output?: OpenAIResponseOutput[];
  usage?: unknown;
};

const suggestedPromptParamSchema = z.object({
  prompt: z.string(),
});

export const workshopSendInputSchema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  content: z.string().trim().min(1).max(20_000),
  model: z.enum(WORKSHOP_MODELS),
  reasoningEffort: z.enum(WORKSHOP_REASONING_EFFORTS).default("medium"),
});

type SuggestedPromptParam = z.infer<typeof suggestedPromptParamSchema>;
export type WorkshopSendInput = z.infer<typeof workshopSendInputSchema>;

type ParsedTextResponse = {
  text: string;
  reasoningSummary?: string;
  suggestedPromptParam?: SuggestedPromptParam;
};

type ProviderTextResponse = ParsedTextResponse & {
  provider: "openai";
  providerRequestId?: string | null;
  providerModel: string;
  usageRaw: unknown;
};

type GenerateAssistantTextOptions = {
  onReasoningSummaryDelta?: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
};

const workshopSystemPrompt = `You are an assistant that helps users create, refine, and adapt prompts for image generation models. Behave like a normal helpful assistant: ask clarifying questions when needed, explain reasoning when useful, and help the user improve their visual idea.

Whenever you provide text intended to be copied directly into an image generation model, use the \`suggest_prompt\` tool instead of writing it in chat.

Only call \`suggest_prompt\` with final image-generation prompt text. Do not include placeholders, instructions to the user, commentary, labels, or multiple-choice scaffolding inside the tool call.

Do not over-optimize before using the tool. If the user’s request is clear enough to produce a usable image prompt, call \`suggest_prompt\` promptly. You may continue discussing improvements afterward if helpful.`;

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

async function verifyThreadOwnership(
  userId: string,
  projectId: string,
  threadId: string,
) {
  const [thread] = await db
    .select()
    .from(workshopThreads)
    .where(
      and(
        eq(workshopThreads.id, threadId),
        eq(workshopThreads.userId, userId),
        eq(workshopThreads.projectId, projectId),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workshop thread not found",
    });
  }

  return thread;
}

function getThreadTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_THREAD_TITLE;

  return normalized.length > 60 ? `${normalized.slice(0, 57)}...` : normalized;
}

async function createWorkshopThread(args: {
  userId: string;
  projectId: string;
  title?: string;
}) {
  const [thread] = await db
    .insert(workshopThreads)
    .values({
      id: crypto.randomUUID(),
      userId: args.userId,
      projectId: args.projectId,
      title: args.title ?? DEFAULT_THREAD_TITLE,
    })
    .returning();

  if (!thread) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create workshop thread",
    });
  }

  return thread;
}

function getProviderMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "reasoning_summary");
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
  const reasoningSummary = data.output
    .flatMap((item) =>
      item.type === "reasoning" && "summary" in item ? (item.summary ?? []) : [],
    )
    .filter((summary) => summary.type === "summary_text" || summary.text)
    .map((summary) => summary.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

  if (!text && functionCallParams.length === 0) {
    throw new Error(
      "OpenAI response did not contain any text or a function call",
    );
  }

  return {
    text,
    reasoningSummary: reasoningSummary || undefined,
    suggestedPromptParam: functionCallParams[0],
  };
}

function createOpenAITextRequestBody(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  stream: boolean,
  reasoningEffort: WorkshopReasoningEffort,
) {
  return {
    model,
    stream,
    reasoning: {
      effort: reasoningEffort,
      summary: "auto",
    },
    instructions: workshopSystemPrompt,
    input: getProviderMessages(messages).map((message) => ({
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
  };
}

function readStreamEventData(block: string) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();

  return data.length > 0 ? data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function generateOpenAIText(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  reasoningEffort: WorkshopReasoningEffort,
) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(
      createOpenAITextRequestBody(model, messages, false, reasoningEffort),
    ),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as OpenAIResponse;
  return {
    ...parseOpenAIResponse(data),
    provider: "openai" as const,
    providerRequestId: data.id ?? null,
    providerModel: model,
    usageRaw: {
      responseUsage: data.usage ?? null,
    },
  };
}

async function generateOpenAITextStream(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  options: GenerateAssistantTextOptions,
  reasoningEffort: WorkshopReasoningEffort,
) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(
      createOpenAITextRequestBody(model, messages, true, reasoningEffort),
    ),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  if (!res.body) {
    throw new Error("OpenAI streaming response did not contain a body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedResponse: OpenAIResponse | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const data = readStreamEventData(block);
      if (!data || data === "[DONE]") continue;

      const event: unknown = JSON.parse(data);
      if (!isRecord(event)) continue;

      if (
        event.type === "response.reasoning_summary_text.delta" &&
        typeof event.delta === "string"
      ) {
        await options.onReasoningSummaryDelta?.(event.delta);
      }

      if (event.type === "response.completed" && isRecord(event.response)) {
        completedResponse = event.response;
      }

      if (event.type === "response.failed") {
        throw new Error("OpenAI streaming response failed");
      }
    }
  }

  if (buffer.trim()) {
    const data = readStreamEventData(buffer);
    if (data && data !== "[DONE]") {
      const event: unknown = JSON.parse(data);
      if (
        isRecord(event) &&
        event.type === "response.completed" &&
        isRecord(event.response)
      ) {
        completedResponse = event.response;
      }
    }
  }

  if (!completedResponse) {
    throw new Error("OpenAI streaming response did not complete");
  }

  return {
    ...parseOpenAIResponse(completedResponse),
    provider: "openai" as const,
    providerRequestId: completedResponse.id ?? null,
    providerModel: model,
    usageRaw: {
      responseUsage: completedResponse.usage ?? null,
    },
  };
}

async function generateAssistantText(
  model: WorkshopModel,
  messages: ChatMessage[],
  reasoningEffort: WorkshopReasoningEffort,
  options: GenerateAssistantTextOptions = {},
) {
  let generated: ProviderTextResponse;
  switch (model) {
    case "gpt-5.5":
    case "gpt-5.4":
    case "gpt-5.4-mini": {
      generated = options.onReasoningSummaryDelta
        ? await generateOpenAITextStream(model, messages, options, reasoningEffort)
        : await generateOpenAIText(model, messages, reasoningEffort);
      const { text, suggestedPromptParam } = generated;
      if (!suggestedPromptParam) {
        return {
          ...generated,
          assistantText: text,
          suggestedPrompt: undefined,
        };
      }
      return {
        ...generated,
        assistantText: text || undefined,
        suggestedPrompt: suggestedPromptParam.prompt,
      };
    }
  }
}

export async function sendWorkshopMessage(args: {
  userId: string;
  input: WorkshopSendInput;
  onThreadReady?: (thread: WorkshopThread) => void | Promise<void>;
  onReasoningSummaryDelta?: (delta: string) => void | Promise<void>;
  signal?: AbortSignal;
}) {
  const { userId, input } = args;

  await verifyProjectOwnership(userId, input.projectId);
  const thread = input.threadId
    ? await verifyThreadOwnership(userId, input.projectId, input.threadId)
    : await createWorkshopThread({
        userId,
        projectId: input.projectId,
        title: getThreadTitle(input.content),
      });

  await args.onThreadReady?.(thread);

  const previousMessages = await db
    .select()
    .from(workshopMessages)
    .where(
      and(
        eq(workshopMessages.userId, userId),
        eq(workshopMessages.projectId, input.projectId),
        eq(workshopMessages.threadId, thread.id),
      ),
    )
    .orderBy(asc(workshopMessages.createdAt));

  const usageRow = await db.transaction(async (tx) => {
    await lockUserUsage(tx, userId);
    const usedCredits = await getUsedCredits(tx, userId);
    if (usedCredits >= MONTHLY_CREDIT_LIMIT) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Monthly credit limit reached",
      });
    }

    return createReservedUsage(tx, {
      userId,
      imageId: null,
      model: input.model,
      credits: WORKSHOP_MESSAGE_CREDITS,
      usageType: "workshop_message",
    });
  });

  const [userMessage] = await db
    .insert(workshopMessages)
    .values({
      id: crypto.randomUUID(),
      userId,
      projectId: input.projectId,
      threadId: thread.id,
      role: "user",
      model: null,
      content: input.content,
    })
    .returning();

  if (!userMessage) {
    await markUsageStatus(usageRow.id, "refunded").catch((err) => {
      console.error("[workshop.sendMessage] failed to refund usage", err);
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to save message",
    });
  }

  let assistantText: string | undefined;
  let reasoningSummary: string | undefined;
  let suggestedPrompt: string | undefined;
  let provider: "openai";
  let providerRequestId: string | null | undefined;
  let providerModel: string;
  let usageRaw: unknown;
  try {
    ({
      assistantText,
      reasoningSummary,
      suggestedPrompt,
      provider,
      providerRequestId,
      providerModel,
      usageRaw,
    } = await generateAssistantText(
      input.model,
      [...previousMessages, userMessage],
      input.reasoningEffort,
      {
        onReasoningSummaryDelta: args.onReasoningSummaryDelta,
        signal: args.signal,
      },
    ));
  } catch (error) {
    console.error("[workshop.sendMessage] provider request failed", error);
    await markUsageStatus(usageRow.id, "refunded").catch((err) => {
      console.error("[workshop.sendMessage] failed to refund usage", err);
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate assistant response",
    });
  }

  if (assistantText === undefined && suggestedPrompt === undefined) {
    console.error("[workshop.sendMessage] got empty response from provider");
    await markUsageStatus(usageRow.id, "refunded").catch((err) => {
      console.error("[workshop.sendMessage] failed to refund usage", err);
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Got empty response from provider",
    });
  }

  const insertedAssistantMessages = await db
    .insert(workshopMessages)
    .values([
      ...(reasoningSummary !== undefined
        ? [
            {
              id: crypto.randomUUID(),
              userId,
              projectId: input.projectId,
              threadId: thread.id,
              model: input.model,
              role: "reasoning_summary" as const,
              content: reasoningSummary,
            },
          ]
        : []),
      ...(assistantText !== undefined
        ? [
            {
              id: crypto.randomUUID(),
              userId,
              projectId: input.projectId,
              threadId: thread.id,
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
              userId,
              projectId: input.projectId,
              threadId: thread.id,
              model: input.model,
              role: "suggest_prompt" as const,
              content: suggestedPrompt,
            },
          ]
        : []),
    ])
    .returning();

  if (insertedAssistantMessages.length === 0) {
    await markUsageStatus(usageRow.id, "refunded").catch((err) => {
      console.error("[workshop.sendMessage] failed to refund usage", err);
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to save assistant response",
    });
  }

  const [updatedThread] = await db
    .update(workshopThreads)
    .set({
      title:
        previousMessages.length === 0 ? getThreadTitle(input.content) : thread.title,
      updatedAt: new Date(),
    })
    .where(eq(workshopThreads.id, thread.id))
    .returning();

  await recordGenerationCostEvent({
    userId,
    usageId: usageRow.id,
    imageId: null,
    provider,
    providerRequestId,
    model: input.model,
    providerModel,
    operation: "workshop_message",
    usageRaw,
    fallbackContext: {
      outputImageCount: 0,
    },
  }).catch((err) => {
    console.error("[workshop.sendMessage] failed to record provider cost", err);
  });

  const didConsume = await markUsageStatus(usageRow.id, "consumed").catch(
    (err) => {
      console.error("[workshop.sendMessage] failed to consume usage", err);
      return false;
    },
  );
  if (!didConsume) {
    console.warn("[workshop.sendMessage] usage row was not consumed");
  }

  return {
    thread: updatedThread ?? thread,
    userMessage,
    assistantMessages: insertedAssistantMessages,
    suggestedPrompt,
  };
}

export const workshopRouter = createTRPCRouter({
  listThreads: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await verifyProjectOwnership(ctx.user, input.projectId);

      return db
        .select()
        .from(workshopThreads)
        .where(
          and(
            eq(workshopThreads.userId, ctx.user),
            eq(workshopThreads.projectId, input.projectId),
          ),
        )
        .orderBy(desc(workshopThreads.updatedAt));
    }),

  createThread: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        title: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyProjectOwnership(ctx.user, input.projectId);

      return createWorkshopThread({
        userId: ctx.user,
        projectId: input.projectId,
        title: input.title,
      });
    }),

  renameThread: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        threadId: z.string().min(1),
        title: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyThreadOwnership(ctx.user, input.projectId, input.threadId);

      const [thread] = await db
        .update(workshopThreads)
        .set({
          title: input.title,
          updatedAt: new Date(),
        })
        .where(eq(workshopThreads.id, input.threadId))
        .returning();

      if (!thread) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rename workshop thread",
        });
      }

      return thread;
    }),

  deleteThread: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        threadId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyThreadOwnership(ctx.user, input.projectId, input.threadId);

      await db
        .delete(workshopThreads)
        .where(
          and(
            eq(workshopThreads.id, input.threadId),
            eq(workshopThreads.userId, ctx.user),
            eq(workshopThreads.projectId, input.projectId),
          ),
        );

      return { success: true };
    }),

  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        threadId: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      await verifyThreadOwnership(ctx.user, input.projectId, input.threadId);

      return db
        .select()
        .from(workshopMessages)
        .where(
          and(
            eq(workshopMessages.userId, ctx.user),
            eq(workshopMessages.projectId, input.projectId),
            eq(workshopMessages.threadId, input.threadId),
          ),
        )
        .orderBy(asc(workshopMessages.createdAt));
    }),

  sendMessage: protectedProcedure
    .input(workshopSendInputSchema)
    .mutation(async ({ ctx, input }) => {
      return sendWorkshopMessage({ userId: ctx.user, input });
    }),

  clear: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        threadId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyThreadOwnership(ctx.user, input.projectId, input.threadId);

      await db
        .delete(workshopMessages)
        .where(
          and(
            eq(workshopMessages.userId, ctx.user),
            eq(workshopMessages.projectId, input.projectId),
            eq(workshopMessages.threadId, input.threadId),
          ),
        );

      return { success: true };
    }),
});
