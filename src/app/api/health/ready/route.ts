import { NextResponse } from "next/server";

import { client } from "src/server/db";
import { createWideEvent } from "src/server/observability/event";

export const dynamic = "force-dynamic";

const READINESS_TIMEOUT_MS = 2_000;

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const event = createWideEvent("health.readiness", { requestId }).set({
    timeoutMs: READINESS_TIMEOUT_MS,
  });

  const readinessQuery = client`select 1`;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      readinessQuery,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          readinessQuery.cancel();
          reject(new Error("Database readiness check timed out"));
        }, READINESS_TIMEOUT_MS);
      }),
    ]);
    event.set({ database: "ok" });

    return NextResponse.json(
      {
        database: "ok",
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
