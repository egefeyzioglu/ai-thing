import { NextResponse } from "next/server";

import {
  createTraceContext,
  parseTraceparent,
} from "src/lib/observability/trace";
import { client } from "src/server/db";
import { createWideEvent } from "src/server/observability/event";

export const dynamic = "force-dynamic";

const READINESS_TIMEOUT_MS = 2_000;

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const event = createWideEvent(
    "health.readiness",
    { requestId },
    {
      trace: createTraceContext(
        parseTraceparent(request.headers.get("traceparent")) ?? undefined,
      ),
    },
  ).set({ timeoutMs: READINESS_TIMEOUT_MS });

  const readinessQuery = client`select 1`;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readinessQuery,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          void Promise.resolve(readinessQuery.cancel()).catch(() => {
            // The timeout response is authoritative even if query cancellation fails.
          });
          reject(new Error("Database readiness check timed out"));
        }, READINESS_TIMEOUT_MS);
      }),
    ]);
    event.set({ database: "ok" });

    return NextResponse.json(
      {
        database: "ok",
        requestId,
        status: "ready",
        version: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    event.fail(error, "database").set({ database: "unavailable" });
    return NextResponse.json(
      {
        database: "unavailable",
        requestId,
        status: "not_ready",
      },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
        status: 503,
      },
    );
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await event.emit();
  }
}
