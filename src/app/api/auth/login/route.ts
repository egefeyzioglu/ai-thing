import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  SESSION_COOKIE_NAME,
  createSession,
  findUserByUsername,
  verifyPassword,
} from "src/server/auth";

const bodySchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const user = await findUserByUsername(parsed.username);
  // Always run verifyPassword to avoid trivial username-enumeration timing.
  const ok =
    user !== undefined &&
    (await verifyPassword(parsed.password, user.passwordHash));

  if (!user || !ok) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: session.id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
