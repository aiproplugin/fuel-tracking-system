import type { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
import { env } from "@/lib/env";
import { ROLES, type RoleName } from "@/lib/permissions";
import { handlers } from "@/server/auth";
import { SESSION_COOKIE_NAME } from "@/server/auth/config";
import { applySessionCookiePolicy } from "@/server/auth/session-cookie-policy";

/**
 * Auth.js route, wrapped so the per-role session-cookie policy is applied to
 * every cookie Auth.js writes.
 *
 * This is the ONLY place session cookies are set: sign-in and sign-out both go
 * through `next-auth/react`, which posts here, and the session endpoint
 * re-issues the cookie from here too. Wrapping both verbs therefore covers
 * every write.
 */

/**
 * Read the role out of a raw session token. The JWT salt is the cookie name.
 * Any failure (tampered, expired, wrong secret) returns null, which leaves the
 * cookie exactly as Auth.js wrote it — the server-side gate in the jwt callback
 * is what actually decides whether such a session is usable.
 */
async function resolveRole(rawToken: string): Promise<RoleName | null> {
  try {
    const payload = await decode({
      token: rawToken,
      secret: env.NEXTAUTH_SECRET,
      salt: SESSION_COOKIE_NAME,
    });
    const role = payload?.role;
    return ROLES.includes(role as RoleName) ? (role as RoleName) : null;
  } catch {
    return null;
  }
}

const withCookiePolicy = (handler: (request: NextRequest) => Promise<Response>) => {
  return async (request: NextRequest): Promise<Response> =>
    applySessionCookiePolicy(await handler(request), SESSION_COOKIE_NAME, resolveRole);
};

export const GET = withCookiePolicy(handlers.GET);
export const POST = withCookiePolicy(handlers.POST);
