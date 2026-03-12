import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware that reads Cloudflare Zero Trust headers.
 *
 * In production, Cloudflare Access sets:
 *   - Cf-Access-Authenticated-User-Email
 *
 * In development, we fall back to a configurable dev email
 * via the `X-Dev-User-Email` header or an env variable.
 */
export function middleware(request: NextRequest) {
  const cfEmail = request.headers.get("cf-access-authenticated-user-email");
  const devEmail =
    request.headers.get("x-dev-user-email") ||
    process.env.DEV_USER_EMAIL ||
    "dev@localhost";

  const email = cfEmail || (process.env.NODE_ENV === "development" ? devEmail : null);

  if (!email) {
    return NextResponse.json(
      { error: "Unauthorized — no Cloudflare Access identity found" },
      { status: 401 }
    );
  }

  // Forward the resolved email as a custom header for server components / API routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-email", email);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  // Apply to all routes except static files and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
