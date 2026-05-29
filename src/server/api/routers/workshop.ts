import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { env } from "src/env";
import { MONTHLY_CREDIT_LIMIT } from "src/lib/credits";
import { createTRPCRouter, protectedProcedure } from "src/server/api/trpc";
import { db } from "src/server/db";
import {
  projects,
  referenceImages,
  workshopMessages,
  workshopThreads,
  type ReferenceImage,
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

const WORKSHOP_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"] as const;
type WorkshopModel = (typeof WORKSHOP_MODELS)[number];
type OpenAIWorkshopModel = WorkshopModel;
const WORKSHOP_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type WorkshopReasoningEffort = (typeof WORKSHOP_REASONING_EFFORTS)[number];
const WORKSHOP_MESSAGE_CREDITS = 1;
const DEFAULT_THREAD_TITLE = "New workshop thread";
const MAX_WORKSHOP_REFERENCE_IMAGES = 8;

type WorkshopAttachmentInput = Pick<ReferenceImage, "id" | "url" | "mimeType">;

type WorkshopMessageWithAttachments = WorkshopMessage & {
  referenceImageIds: string[];
  attachments: WorkshopAttachmentInput[];
};

type ChatMessage = Pick<
  WorkshopMessageWithAttachments,
  "role" | "content" | "attachments"
>;

type OpenAIInputTextContent = {
  type: "input_text";
  text: string;
};

type OpenAIInputImageContent = {
  type: "input_image";
  image_url: string;
};

type OpenAIInputContent = OpenAIInputTextContent | OpenAIInputImageContent;

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

type OpenAIResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    image_tokens?: number;
    text_tokens?: number;
  };
  output_tokens_details?: {
    image_tokens?: number;
    reasoning_tokens?: number;
  };
};

type OpenAITextRequestBody = {
  model: OpenAIWorkshopModel;
  stream: boolean;
  reasoning: {
    effort: WorkshopReasoningEffort;
    summary: "auto";
  };
  instructions: string;
  input:
    | {
        role: "user" | "assistant";
        content: string | OpenAIInputContent[];
      }[]
    | {
        type: "function_call_output";
        call_id: string;
        output: string;
      }[];
  tools: {
    name: "suggest_prompt";
    description: string;
    type: "function";
    parameters: {
      type: "object";
      properties: {
        prompt: {
          type: "string";
          description: string;
        };
      };
    };
  }[];
  previous_response_id?: string;
  tool_choice?: "auto" | "none";
  parallel_tool_calls?: boolean;
};

const suggestedPromptParamSchema = z.object({
  prompt: z.string(),
});

export const workshopSendInputSchema = z
  .object({
    projectId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    content: z.string().trim().max(20_000),
    model: z.enum(WORKSHOP_MODELS),
    reasoningEffort: z.enum(WORKSHOP_REASONING_EFFORTS).default("medium"),
    referenceImageIds: z
      .array(z.string().min(1))
      .max(MAX_WORKSHOP_REFERENCE_IMAGES)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.content.length > 0 ||
      (value.referenceImageIds?.length ?? 0) > 0
    ) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Workshop message must include text or an image attachment",
      path: ["content"],
    });
  });

type SuggestedPromptParam = z.infer<typeof suggestedPromptParamSchema>;
export type WorkshopSendInput = z.infer<typeof workshopSendInputSchema>;

type ParsedTextResponse = {
  text: string;
  reasoningSummary?: string;
  suggestedPromptParam?: SuggestedPromptParam;
  suggestedPromptCallId?: string;
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

function normalizeReferenceImageIds(ids?: string[]) {
  return Array.from(new Set(ids ?? [])).slice(0, MAX_WORKSHOP_REFERENCE_IMAGES);
}

async function loadOwnedReferenceImages(userId: string, ids: string[]) {
  if (ids.length === 0) return [];

  const images = await db
    .select({
      id: referenceImages.id,
      url: referenceImages.url,
      mimeType: referenceImages.mimeType,
    })
    .from(referenceImages)
    .where(
      and(eq(referenceImages.userId, userId), inArray(referenceImages.id, ids)),
    );

  if (images.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One or more image attachments could not be found",
    });
  }

  const byId = new Map(images.map((image) => [image.id, image]));
  return ids.map((id) => byId.get(id)).filter((image) => image !== undefined);
}

function getMessageReferenceIds(message: WorkshopMessage) {
  return Array.isArray(message.referenceImages)
    ? message.referenceImages.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
}

async function hydrateWorkshopMessages(
  messages: WorkshopMessage[],
): Promise<WorkshopMessageWithAttachments[]> {
  const referenceImageIds = Array.from(
    new Set(messages.flatMap((message) => getMessageReferenceIds(message))),
  );

  const attachments =
    referenceImageIds.length > 0
      ? await db
          .select({
            id: referenceImages.id,
            url: referenceImages.url,
            mimeType: referenceImages.mimeType,
          })
          .from(referenceImages)
          .where(inArray(referenceImages.id, referenceImageIds))
      : [];
  const attachmentsById = new Map(
    attachments.map((image) => [image.id, image]),
  );

  return messages.map((message) => {
    const ids = getMessageReferenceIds(message);
    return {
      ...message,
      referenceImageIds: ids,
      attachments: ids
        .map((id) => attachmentsById.get(id))
        .filter((image) => image !== undefined),
    };
  });
}

function buildProviderInput(messages: ChatMessage[]): {
  role: "user" | "assistant";
  content: string | OpenAIInputContent[];
}[] {
  return getProviderMessages(messages).map((message) => {
    const role: "user" | "assistant" =
      message.role === "user" ? "user" : "assistant";
    if (role === "assistant" || message.attachments.length === 0) {
      return {
        role,
        content: message.content,
      };
    }

    const content: OpenAIInputContent[] = [
      {
        type: "input_text",
        text:
          message.content ||
          "Use the attached image(s) as reference for this prompt workshop request.",
      },
      ...message.attachments
        .filter((image): image is WorkshopAttachmentInput & { url: string } =>
          Boolean(image.url),
        )
        .map((image) => ({
          type: "input_image" as const,
          image_url: image.url,
        })),
    ];

    return { role, content };
  });
}

function getProviderMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role !== "reasoning_summary");
}

function parseOpenAIResponse(
  data: OpenAIResponse,
  options: { allowEmpty?: boolean } = {},
): ParsedTextResponse {
  if (!data.output) {
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return { text: data.output_text };
    }

    if (options.allowEmpty) return { text: "" };

    throw new Error("OpenAI response did not contain output or output_text");
  }

  const functionCallParams = data.output
    .filter((item) => item.type === "function_call")
    .map((content) => {
      if (!("arguments" in content) || content.name !== "suggest_prompt") {
        return undefined;
      }

      const parsedArguments: unknown = JSON.parse(content.arguments);
      return {
        callId: content.call_id,
        param: suggestedPromptParamSchema.parse(parsedArguments),
      };
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
      item.type === "reasoning" && "summary" in item
        ? (item.summary ?? [])
        : [],
    )
    .filter((summary) => summary.type === "summary_text" || summary.text)
    .map((summary) => summary.text)
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim();

  if (!text && functionCallParams.length === 0 && !options.allowEmpty) {
    throw new Error(
      "OpenAI response did not contain any text or a function call",
    );
  }

  return {
    text,
    reasoningSummary: reasoningSummary || undefined,
    suggestedPromptParam: functionCallParams[0]?.param,
    suggestedPromptCallId: functionCallParams[0]?.callId,
  };
}

function createOpenAITextRequestBody(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  stream: boolean,
  reasoningEffort: WorkshopReasoningEffort,
): OpenAITextRequestBody {
  return {
    model,
    stream,
    reasoning: {
      effort: reasoningEffort,
      summary: "auto",
    },
    instructions: workshopSystemPrompt,
    input: buildProviderInput(messages),
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
    tool_choice: "auto",
    parallel_tool_calls: false,
  };
}

function createOpenAITextContinuationRequestBody(
  model: OpenAIWorkshopModel,
  previousResponseId: string,
  suggestedPromptCallId: string,
  stream: boolean,
  reasoningEffort: WorkshopReasoningEffort,
): OpenAITextRequestBody {
  return {
    ...createOpenAITextRequestBody(model, [], stream, reasoningEffort),
    input: [
      {
        type: "function_call_output",
        call_id: suggestedPromptCallId,
        output: JSON.stringify({ status: "recorded" }),
      },
    ],
    previous_response_id: previousResponseId,
    tool_choice: "none",
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

function readUsageNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeOpenAIResponseUsage(
  usage: unknown,
): OpenAIResponseUsage | undefined {
  if (!isRecord(usage)) return undefined;

  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;
  const outputDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : undefined;

  return {
    input_tokens: readUsageNumber(usage, "input_tokens"),
    output_tokens: readUsageNumber(usage, "output_tokens"),
    total_tokens: readUsageNumber(usage, "total_tokens"),
    input_tokens_details: {
      cached_tokens: inputDetails
        ? readUsageNumber(inputDetails, "cached_tokens")
        : undefined,
      image_tokens: inputDetails
        ? readUsageNumber(inputDetails, "image_tokens")
        : undefined,
      text_tokens: inputDetails
        ? readUsageNumber(inputDetails, "text_tokens")
        : undefined,
    },
    output_tokens_details: {
      image_tokens: outputDetails
        ? readUsageNumber(outputDetails, "image_tokens")
        : undefined,
      reasoning_tokens: outputDetails
        ? readUsageNumber(outputDetails, "reasoning_tokens")
        : undefined,
    },
  };
}

function addNumbers(...values: (number | undefined)[]) {
  const numbers = values.filter(
    (value): value is number => value !== undefined,
  );
  if (numbers.length === 0) return undefined;

  return numbers.reduce((total, value) => total + value, 0);
}

function mergeOpenAIResponseUsage(usages: unknown[]) {
  const normalized = usages
    .map((usage) => normalizeOpenAIResponseUsage(usage))
    .filter((usage) => usage !== undefined);

  if (normalized.length === 0) return null;

  return {
    input_tokens: addNumbers(...normalized.map((usage) => usage.input_tokens)),
    output_tokens: addNumbers(
      ...normalized.map((usage) => usage.output_tokens),
    ),
    total_tokens: addNumbers(...normalized.map((usage) => usage.total_tokens)),
    input_tokens_details: {
      cached_tokens: addNumbers(
        ...normalized.map((usage) => usage.input_tokens_details?.cached_tokens),
      ),
      image_tokens: addNumbers(
        ...normalized.map((usage) => usage.input_tokens_details?.image_tokens),
      ),
      text_tokens: addNumbers(
        ...normalized.map((usage) => usage.input_tokens_details?.text_tokens),
      ),
    },
    output_tokens_details: {
      image_tokens: addNumbers(
        ...normalized.map((usage) => usage.output_tokens_details?.image_tokens),
      ),
      reasoning_tokens: addNumbers(
        ...normalized.map(
          (usage) => usage.output_tokens_details?.reasoning_tokens,
        ),
      ),
    },
  };
}

function mergeParsedOpenAIResponses(responses: OpenAIResponse[]) {
  const parsedResponses = responses.map((response) =>
    parseOpenAIResponse(response, { allowEmpty: true }),
  );

  return {
    text: parsedResponses
      .map((parsed) => parsed.text)
      .filter(Boolean)
      .join("\n\n")
      .trim(),
    reasoningSummary:
      parsedResponses
        .map((parsed) => parsed.reasoningSummary)
        .filter((summary): summary is string => summary !== undefined)
        .join("\n\n")
        .trim() || undefined,
    suggestedPromptParam: parsedResponses.find(
      (parsed) => parsed.suggestedPromptParam,
    )?.suggestedPromptParam,
  };
}

async function createOpenAIResponse(
  body: OpenAITextRequestBody,
  signal?: AbortSignal,
) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text}`);
  }

  return (await res.json()) as OpenAIResponse;
}

async function generateOpenAIText(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  reasoningEffort: WorkshopReasoningEffort,
) {
  const data = await createOpenAIResponse(
    createOpenAITextRequestBody(model, messages, false, reasoningEffort),
  );
  const parsed = parseOpenAIResponse(data);
  const responses = [data];

  if (data.id && parsed.suggestedPromptCallId) {
    responses.push(
      await createOpenAIResponse(
        createOpenAITextContinuationRequestBody(
          model,
          data.id,
          parsed.suggestedPromptCallId,
          false,
          reasoningEffort,
        ),
      ),
    );
  }

  const merged = mergeParsedOpenAIResponses(responses);
  return {
    ...merged,
    provider: "openai" as const,
    providerRequestId:
      responses
        .map((response) => response.id)
        .filter(Boolean)
        .join(",") || null,
    providerModel: model,
    usageRaw: {
      responseUsage: mergeOpenAIResponseUsage(
        responses.map((response) => response.usage),
      ),
    },
  };
}

async function createOpenAIResponseStream(
  body: OpenAITextRequestBody,
  options: GenerateAssistantTextOptions,
) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
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

  return completedResponse;
}

async function generateOpenAITextStream(
  model: OpenAIWorkshopModel,
  messages: ChatMessage[],
  options: GenerateAssistantTextOptions,
  reasoningEffort: WorkshopReasoningEffort,
) {
  const firstResponse = await createOpenAIResponseStream(
    createOpenAITextRequestBody(model, messages, true, reasoningEffort),
    options,
  );
  const parsed = parseOpenAIResponse(firstResponse);
  const responses = [firstResponse];

  if (firstResponse.id && parsed.suggestedPromptCallId) {
    responses.push(
      await createOpenAIResponseStream(
        createOpenAITextContinuationRequestBody(
          model,
          firstResponse.id,
          parsed.suggestedPromptCallId,
          true,
          reasoningEffort,
        ),
        options,
      ),
    );
  }

  const merged = mergeParsedOpenAIResponses(responses);
  return {
    ...merged,
    provider: "openai" as const,
    providerRequestId:
      responses
        .map((response) => response.id)
        .filter(Boolean)
        .join(",") || null,
    providerModel: model,
    usageRaw: {
      responseUsage: mergeOpenAIResponseUsage(
        responses.map((response) => response.usage),
      ),
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
        ? await generateOpenAITextStream(
            model,
            messages,
            options,
            reasoningEffort,
          )
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
  const referenceImageIds = normalizeReferenceImageIds(input.referenceImageIds);

  await verifyProjectOwnership(userId, input.projectId);
  await loadOwnedReferenceImages(userId, referenceImageIds);
  const existingThread = input.threadId
    ? await verifyThreadOwnership(userId, input.projectId, input.threadId)
    : null;

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

  let thread: WorkshopThread;
  try {
    thread =
      existingThread ??
      (await createWorkshopThread({
        userId,
        projectId: input.projectId,
        title: getThreadTitle(input.content || "Image attachment"),
      }));
  } catch (error) {
    await markUsageStatus(usageRow.id, "refunded").catch((err) => {
      console.error("[workshop.sendMessage] failed to refund usage", err);
    });
    throw error;
  }

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
  const hydratedPreviousMessages =
    await hydrateWorkshopMessages(previousMessages);

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
      referenceImages: referenceImageIds.length > 0 ? referenceImageIds : null,
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
      [
        ...hydratedPreviousMessages,
        ...(await hydrateWorkshopMessages([userMessage])),
      ],
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
        previousMessages.length === 0
          ? getThreadTitle(input.content || "Image attachment")
          : thread.title,
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
    userMessage: (await hydrateWorkshopMessages([userMessage]))[0]!,
    assistantMessages: await hydrateWorkshopMessages(insertedAssistantMessages),
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

      const messages = await db
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

      return hydrateWorkshopMessages(messages);
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
