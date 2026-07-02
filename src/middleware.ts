import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy.
 * - 'unsafe-eval' is required only by the Next.js dev overlay (dev builds only).
 * - 'unsafe-inline' for scripts/styles is required by Next.js hydration and
 *   Tailwind today; tightening to a nonce-based policy is a Phase 7 item
 *   (tracked in docs/security.md).
 * - Inter is self-hosted via next/font, so no external font origins are needed.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  `connect-src 'self'${isDevelopment ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Camera stays available to same origin: the operator QR scanner needs it.
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");

  if (!isDevelopment) {
    // Only meaningful over HTTPS; harmless (ignored) over plain HTTP.
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }

  return response;
}

export const config = {
  // Apply to every route (pages + API); skip static assets served by Next.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
