import { auth } from "@clerk/nextjs/server";

import {
  sendWorkshopMessage,
  workshopSendInputSchema,
} from "src/server/api/routers/workshop";
import { createWideEvent } from "src/server/observability/event";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const incomingRequestId = req.headers.get("x-request-id")?.trim();
  const requestId =
    incomingRequestId && incomingRequestId.length > 0
      ? incomingRequestId
      : crypto.randomUUID();
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = workshopSendInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid workshop message" },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const event = createWideEvent("workshop.stream", { requestId, userId });
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeEvent(event, data)));
      };

      try {
        const result = await sendWorkshopMessage({
          userId,
          input: parsed.data,
          signal: req.signal,
          onThreadReady(thread) {
            send("thread", { thread });
          },
          onReasoningSummaryDelta(delta) {
            send("reasoning_delta", { delta });
          },
        });

        event.set({
          threadId: result.thread.id,
        });
        send("done", result);
      } catch (error) {
        event.fail(error, "send_message");
        send("error", {
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate assistant response",
        });
      } finally {
        controller.close();
        try {
          await event.emit();
        } catch (emitError) {
          console.error(
            "[workshop.stream] failed to emit completion event",
            emitError,
          );
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Request-Id": requestId,
    },
  });
}
