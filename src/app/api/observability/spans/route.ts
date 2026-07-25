import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createWideEvent } from "src/server/observability/event";

const MAX_BROWSER_SPAN_BYTES = 16_384;
const MAX_SPANS_PER_USER_PER_MINUTE = 120;
const rateLimits = new Map<string, { count: number; windowStartedAt: number }>();
let lastRateLimitCleanup = Date.now();

const hexId = (length: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));

const browserSpanSchema = z
  .object({
    attributes: z
      .record(
        z.string(),
        z.union([z.boolean(), z.number(), z.string(), z.null()]),
      )
      .refine((attributes) => Object.keys(attributes).length <= 30),
    durationMs: z.number().finite().min(0).max(3_600_000),
    name: z
      .string()
      .regex(/^browser\.[a-z0-9_.-]+$/)
      .max(100),
    outcome: z.enum(["success", "expected_error", "unexpected_error"]),
    requestId: z.string().uuid().optional(),
    startedAt: z.coerce.date(),
    trace: z.object({
      parentSpanId: hexId(16).optional(),
      spanId: hexId(16),
      traceFlags: hexId(2),
      traceId: hexId(32),
    }),
  })
  .strict();

async function readBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {
          // The size limit remains authoritative if stream cancellation fails.
        });
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  if (now - lastRateLimitCleanup >= 60_000) {
    for (const [key, limit] of rateLimits) {
      if (now - limit.windowStartedAt >= 60_000) rateLimits.delete(key);
    }
    lastRateLimitCleanup = now;
  }
  const currentLimit = rateLimits.get(userId);
  if (!currentLimit || now - currentLimit.windowStartedAt >= 60_000) {
    rateLimits.set(userId, { count: 1, windowStartedAt: now });
  } else if (currentLimit.count >= MAX_SPANS_PER_USER_PER_MINUTE) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  } else {
    currentLimit.count += 1;
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isFinite(contentLength) ||
    contentLength > MAX_BROWSER_SPAN_BYTES
  ) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await readBodyWithinLimit(request, MAX_BROWSER_SPAN_BYTES);
    if (rawBody === null) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = browserSpanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid browser span" },
      { status: 400 },
    );
  }

  const span = parsed.data;
  try {
    await createWideEvent(
      span.name,
      { requestId: span.requestId, userId },
      {
        durationMs: span.durationMs,
        startedAt: span.startedAt,
        trace: span.trace,
      },
    )
      .set({ ...span.attributes, source: "browser" })
      .outcome(span.outcome)
      .emit();
  } catch (error) {
    console.error("[observability] Failed to accept browser span", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new NextResponse(null, { status: 202 });
}
