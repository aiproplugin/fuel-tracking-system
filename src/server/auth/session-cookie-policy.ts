import type { RoleName } from "@/lib/permissions";
import { sessionCookieMode } from "@/lib/session-policy";

/**
 * PER-ROLE SESSION COOKIE TYPE.
 *
 * Privileged roles must lose their session when the browser closes; operators
 * must keep theirs across restarts. Auth.js cannot express that: it hard-codes
 * `expires: now + session.maxAge` onto the session cookie at every write
 * (@auth/core/lib/actions/callback/index.js), and `cookies.sessionToken.options`
 * is one static object shared by all users.
 *
 * So we post-process the Set-Cookie headers Auth.js emits, in the one route
 * that emits them (app/api/auth/[...nextauth]/route.ts). Dropping Expires and
 * Max-Age turns a persistent cookie into a browser-session cookie, which the
 * browser discards on close. Nothing else about the cookie changes: HttpOnly,
 * SameSite, Secure, and Path are Auth.js's own and are carried through
 * untouched.
 *
 * This is the browser-side half of the control and is not load-bearing on its
 * own — a cookie that survives a browser close anyway still dies on the
 * server-side idle and absolute limits in the jwt callback.
 */

/** Attributes that make a cookie persistent. Both must go, or it survives. */
const EXPIRY_ATTRIBUTES = new Set(["expires", "max-age"]);

/** The cookie name plus the `.0`, `.1`, … chunks Auth.js splits large tokens into. */
function isSessionCookie(cookie: string, sessionCookieName: string): boolean {
  const name = cookieName(cookie);
  return name === sessionCookieName || name.startsWith(`${sessionCookieName}.`);
}

function cookieName(cookie: string): string {
  const firstPart = cookie.split(";", 1)[0] ?? "";
  const equals = firstPart.indexOf("=");
  return (equals === -1 ? firstPart : firstPart.slice(0, equals)).trim();
}

function cookieValue(cookie: string): string {
  const firstPart = cookie.split(";", 1)[0] ?? "";
  const equals = firstPart.indexOf("=");
  return equals === -1 ? "" : firstPart.slice(equals + 1).trim();
}

/** Chunk index for ordering (`name.0`, `name.1`); -1 for the unchunked cookie. */
function chunkIndex(cookie: string, sessionCookieName: string): number {
  const suffix = cookieName(cookie).slice(sessionCookieName.length + 1);
  const parsed = Number.parseInt(suffix, 10);
  return Number.isNaN(parsed) ? -1 : parsed;
}

/**
 * Remove Expires/Max-Age. Splitting on ";" is safe: the Expires date contains a
 * comma but never a semicolon.
 */
export function stripCookieExpiry(cookie: string): string {
  const parts = cookie.split(";");
  const kept = parts.filter((part, index) => {
    if (index === 0) return true; // name=value
    const attribute = part.trim().split("=", 1)[0]?.toLowerCase() ?? "";
    return !EXPIRY_ATTRIBUTES.has(attribute);
  });
  return kept.join(";");
}

/**
 * Apply the per-role cookie policy to a batch of Set-Cookie headers.
 *
 * @param setCookies    Raw Set-Cookie header values, as emitted by Auth.js.
 * @param sessionCookieName  Configured session-token cookie name.
 * @param resolveRole   Decodes a raw session token to its role, or null when it
 *                      cannot be read. Injected so the rewriter stays pure and
 *                      testable without a real JWT.
 */
export async function rewriteSessionCookies(
  setCookies: readonly string[],
  sessionCookieName: string,
  resolveRole: (rawToken: string) => Promise<RoleName | null>,
): Promise<string[]> {
  const sessionCookies = setCookies.filter((cookie) => isSessionCookie(cookie, sessionCookieName));
  if (sessionCookies.length === 0) {
    return [...setCookies];
  }

  // An empty value is Auth.js DELETING the cookie (sign-out, or clearing a
  // session the jwt callback rejected). That deletion is carried by Max-Age=0,
  // so stripping expiry attributes would turn a logout into a no-op.
  const rawToken = sessionCookies
    .slice()
    .sort((a, b) => chunkIndex(a, sessionCookieName) - chunkIndex(b, sessionCookieName))
    .map((cookie) => cookieValue(cookie))
    .join("");
  if (rawToken === "") {
    return [...setCookies];
  }

  const role = await resolveRole(rawToken);
  // Unreadable token: leave Auth.js's own cookie untouched. The session is
  // still governed server-side by the jwt callback, which rejects anything it
  // cannot verify.
  if (role === null || sessionCookieMode(role) !== "BROWSER_SESSION") {
    return [...setCookies];
  }

  return setCookies.map((cookie) =>
    isSessionCookie(cookie, sessionCookieName) ? stripCookieExpiry(cookie) : cookie,
  );
}

/**
 * Rebuild a Response with the rewritten Set-Cookie headers. A Response's
 * headers may be immutable, so a new one is constructed around the same body,
 * status, and remaining headers.
 */
export async function applySessionCookiePolicy(
  response: Response,
  sessionCookieName: string,
  resolveRole: (rawToken: string) => Promise<RoleName | null>,
): Promise<Response> {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) {
    return response;
  }

  const rewritten = await rewriteSessionCookies(setCookies, sessionCookieName, resolveRole);
  if (rewritten.every((cookie, index) => cookie === setCookies[index])) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  for (const cookie of rewritten) {
    headers.append("set-cookie", cookie);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
