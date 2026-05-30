import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      forceRefreshNotify:
        process.env.NEXT_PUBLIC_REFRESH_NOTIFY_DEBUG === "true",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
