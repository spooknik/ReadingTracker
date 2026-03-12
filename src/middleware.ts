import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware that identifies the current user.
 *
 * Resolution order:
 *   1. Cloudflare Zero Trust header (Cf-Access-Authenticated-User-Email)
 *   2. DEFAULT_USER_EMAIL env var (for LAN / self-hosted without Cloudflare)
 *   3. DEV_USER_EMAIL or "dev@localhost" (development only)
 *
 * Set DEFAULT_USER_EMAIL in production to allow access without Cloudflare.
 * Once Cloudflare Access is configured, the header takes priority automatically.
 */
export function middleware(request: NextRequest) {
  const cfEmail = request.headers.get("cf-access-authenticated-user-email");
  const defaultEmail = process.env.DEFAULT_USER_EMAIL;
  const devEmail =
    request.headers.get("x-dev-user-email") ||
    process.env.DEV_USER_EMAIL ||
    "dev@localhost";

  const email =
    cfEmail ||
    defaultEmail ||
    (process.env.NODE_ENV === "development" ? devEmail : null);

  if (!email) {
    return NextResponse.json(
      { error: "Unauthorized — no Cloudflare Access identity found. Set DEFAULT_USER_EMAIL env var for LAN access." },
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
