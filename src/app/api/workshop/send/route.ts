import { auth } from "@clerk/nextjs/server";

import {
  sendWorkshopMessage,
  workshopSendInputSchema,
} from "src/server/api/routers/workshop";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = workshopSendInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid workshop message" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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

        send("done", result);
      } catch (error) {
        console.error("[workshop.stream] failed to send message", error);
        send("error", {
          message:
            error instanceof Error
              ? error.message
              : "Failed to generate assistant response",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
