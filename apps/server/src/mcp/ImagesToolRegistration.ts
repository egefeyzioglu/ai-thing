/**
 * Registers the image tools by hand: `McpServer.toolkit` would serialize
 * results as JSON text, but these return previews as image blocks (several of
 * them for variants). Text and a small structured summary go out together,
 * since Claude Code shows `structuredContent` instead of the text when both
 * are present.
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";

import * as McpInvocationContext from "./McpInvocationContext.ts";
import {
  make as makeImagesToolHandlers,
  type ImagesToolHandlers,
} from "./toolkits/images/handlers.ts";
import {
  EditImageTool,
  GenerateImageTool,
  ImageHistoryTool,
  type ImagesToolOutput,
  ListImageModelsTool,
  RestoreImageVersionTool,
  ViewImageTool,
} from "./toolkits/images/tools.ts";

function failureText(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "The image tool failed.";
}

function toCallToolResult(output: ImagesToolOutput): McpSchema.CallToolResult {
  return new McpSchema.CallToolResult({
    isError: false,
    structuredContent: output.structured ?? { text: output.text },
    content: [
      { type: "text", text: output.text },
      ...output.images.map((image) => ({
        type: "image" as const,
        data: new Uint8Array(Buffer.from(image.data, "base64")),
        mimeType: image.mimeType,
      })),
    ],
  });
}

const registerImagesTools = Effect.gen(function* () {
  const server = yield* McpServer.McpServer;
  const handlers = yield* makeImagesToolHandlers;

  const register = <T extends Tool.Any>(
    tool: T,
    handle: (input: Tool.Parameters<T>) => ReturnType<ImagesToolHandlers[keyof ImagesToolHandlers]>,
  ) => {
    const decode = Schema.decodeUnknownEffect(
      tool.parametersSchema as Schema.Codec<Tool.Parameters<T>, unknown>,
    );
    return server.addTool({
      tool: new McpSchema.Tool({
        name: tool.name,
        description: Tool.getDescription(tool),
        inputSchema: Tool.getJsonSchema(tool),
        annotations: {
          ...Context.getOption(tool.annotations, Tool.Title).pipe(
            Option.map((title) => ({ title })),
            Option.getOrUndefined,
          ),
          readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
          destructiveHint: Context.get(tool.annotations, Tool.Destructive),
          idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
          openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
        },
      }),
      annotations: tool.annotations,
      handle: (payload: unknown) =>
        Effect.withFiber((fiber) => {
          const invocation = Context.getUnsafe(
            fiber.context,
            McpInvocationContext.McpInvocationContext,
          );
          return decode(payload ?? {}).pipe(
            Effect.flatMap((input) => handle(input)),
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.matchCauseEffect({
              onFailure: (cause) => {
                if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
                  return Effect.failCause(cause).pipe(Effect.orDie);
                }
                const text = failureText(cause);
                return Effect.logWarning(`${tool.name} failed`, { message: text }).pipe(
                  Effect.as(
                    new McpSchema.CallToolResult({
                      isError: true,
                      structuredContent: { error: text },
                      content: [{ type: "text", text }],
                    }),
                  ),
                );
              },
              onSuccess: (output) => Effect.succeed(toCallToolResult(output)),
            }),
          );
        }),
    });
  };

  yield* register(ListImageModelsTool, handlers.list_image_models);
  yield* register(GenerateImageTool, handlers.generate_image);
  yield* register(EditImageTool, handlers.edit_image);
  yield* register(ImageHistoryTool, handlers.image_history);
  yield* register(RestoreImageVersionTool, handlers.restore_image_version);
  yield* register(ViewImageTool, handlers.view_image);
});

export const ImagesToolkitRegistrationLive = Layer.effectDiscard(registerImagesTools);
