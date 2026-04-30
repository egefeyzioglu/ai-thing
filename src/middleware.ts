import { type NextRequest, NextResponse } from "next/server";

// Edge-safe: just check cookie presence. Real validation happens in
// server code (tRPC context, route handlers) which has DB access.
const SESSION_COOKIE_NAME = "session";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSession) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except: login page, auth endpoints, Next internals,
  // and static assets. tRPC and other API routes still run through here.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
