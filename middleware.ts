import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";

/**
 * Middleware.
 *
 * This is an **optimistic redirect only** and is never a security boundary:
 *
 *  - On Cloudflare Workers, Node.js middleware does not run, so every rule that
 *    matters is enforced in the DAL, in Server Actions and in Route Handlers.
 *  - Even where it does run, it does not verify the token: that needs
 *    `node:crypto` and a database round-trip, neither of which belongs in the
 *    Edge runtime. It looks only at whether a session cookie is *present*, to
 *    save an authenticated visitor a wasted render.
 *
 * A missing cookie sends you to /login; a forged or revoked cookie gets through
 * here and is stopped by `requirePrincipal()`. That is the design, not a gap.
 *
 * Anything that needs a real decision calls `requirePrincipal()` or
 * `requireAdmin()` from lib/dal/guards.ts.
 */

const PUBLIC_PATHS = new Set([
  "/login",
  "/mfa",
  "/api/auth/github",
  "/api/auth/callback/github",
  "/api/health",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (!request.cookies.get(ACCESS_COOKIE)?.value) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
