import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      service: "ai-thing",
      status: "ok",
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
