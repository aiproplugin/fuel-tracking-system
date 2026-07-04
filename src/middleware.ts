import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Generate a fresh, unguessable CSP nonce per request. Uses Web Crypto so it
 * runs on the edge runtime (no Node Buffer). base64 of 16 random bytes.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the Content-Security-Policy for this request.
 *
 * Production (Phase 7): script-src is nonce-based with 'strict-dynamic' and
 * NO 'unsafe-inline' — Next.js stamps the per-request nonce onto its own
 * scripts (it reads the CSP we set on the request headers below), and
 * 'strict-dynamic' lets those trusted scripts load the chunk graph. 'self' is
 * kept as a CSP2 fallback for browsers that ignore 'strict-dynamic'.
 *
 * Development: HMR and the Next dev overlay rely on eval and un-nonced inline
 * scripts, so script-src stays permissive there. The strict policy is what
 * ships to the on-prem server.
 *
 * style-src keeps 'unsafe-inline': Next/Tailwind inject un-nonced inline
 * styles, and styles are a far lower XSS risk than scripts. Tightening styles
 * is out of scope for this task (which targets script-src).
 */
function buildCsp(nonce: string, isDevelopment: boolean): string {
  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDevelopment ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === "development";
  const nonce = generateNonce();
  const csp = buildCsp(nonce, isDevelopment);

  // Next.js reads the CSP (and nonce) from the REQUEST headers to stamp the
  // nonce onto its framework scripts, so it must be set on the forwarded
  // request as well as the response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
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
