import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, deleteSession } from "src/server/auth";

export async function POST(req: NextRequest) {
  const sessionId = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) {
    try {
      await deleteSession(sessionId);
    } catch {
      // ignore — clear the cookie regardless
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
