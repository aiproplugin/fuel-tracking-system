import { randomUUID } from "node:crypto";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { SESSION_TOKEN_CEILING_SECONDS } from "@/lib/session-policy";
import { loginInputSchema } from "@/lib/validation";
import { clientIpFromHeaders } from "@/server/context/request-context";
import { loginRateLimiter } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/services/audit.service";
import {
  createUserSession,
  deleteUserSession,
  resolveSessionState,
} from "@/server/services/session-policy.service";
import { verifyUserCredentials } from "@/server/services/user.service";

const useSecureCookies = env.NEXTAUTH_URL.startsWith("https://");

/**
 * Session-token cookie name. Exported because the JWT salt is the cookie name,
 * so anything decoding the token out-of-band (the cookie-policy rewriter) must
 * use exactly this value.
 */
export const SESSION_COOKIE_NAME = useSecureCookies
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

/**
 * JWT claims are `unknown` at the type level (the next-auth/jwt module
 * augmentation is not applied inside callbacks in v5 beta), so every claim
 * is narrowed defensively before use — an unexpected shape degrades to the
 * least-privileged value instead of being trusted.
 */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

const ALL_ROLES: readonly Role[] = Object.values(Role);

function asRole(value: unknown): Role {
  return ALL_ROLES.includes(value as Role) ? (value as Role) : Role.OPERATOR;
}

/**
 * Best-effort client IP for the credentials flow. The Auth.js route runs
 * outside the tRPC request-context binding, so login/lockout events resolve
 * the IP explicitly from their own request. Direct connections have no
 * forwarding headers; the production reverse proxy sets x-forwarded-for.
 */
function getClientIp(request: Request | undefined): string | null {
  if (!request) return null;
  return clientIpFromHeaders(request.headers);
}

/**
 * Auth.js v5 configuration — hardened Credentials flow (Phase 1).
 *
 * Every failure path (bad input, rate-limited, unknown user, locked,
 * inactive, wrong password) returns null, which Auth.js surfaces as the
 * same generic CredentialsSignin error: no user enumeration, no lockout
 * oracle. Lockout/backoff, timing equalization, and audit logging live in
 * user.service.ts.
 */
export const authConfig = {
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const parsed = loginInputSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const ipAddress = getClientIp(request);
        const rateKey = `${ipAddress ?? "unknown"}:${parsed.data.username.trim().toLowerCase()}`;
        const rate = loginRateLimiter.consume(rateKey);
        if (!rate.allowed) {
          await recordAuditEvent({
            action: "LOGIN_RATE_LIMITED",
            entityType: "user",
            ipAddress,
          });
          return null;
        }

        const user = await verifyUserCredentials({
          username: parsed.data.username,
          password: parsed.data.password,
          ipAddress,
        });
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          name: user.displayName,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          defaultTankId: user.defaultTankId,
          siteId: user.siteId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * THE SESSION-LIFETIME GATE. This callback runs on EVERY session read —
     * tRPC context, server components, the Auth.js routes — and returning null
     * makes Auth.js clear the session cookies and hand back a null session
     * (@auth/core/lib/actions/session.js). There is no request path that reads a
     * session without passing through here, which is why expiry is decided
     * ONLY here and never by a client-side timer.
     *
     * The session's lifetime is not carried in the token: bare `auth()` calls
     * (how this codebase reads sessions everywhere) discard response cookies,
     * so a token claim could never be refreshed on activity. Last activity
     * lives in `user_session`, keyed by the opaque `sid` minted below.
     */
    async jwt({ token, user }) {
      // `user` is only present on sign-in; role and tank binding are fixed
      // for the session's lifetime (reassignment requires a fresh login).
      if (user) {
        // authorize() always supplies an id; the Auth.js User type marks it
        // optional. Without one the session cannot be tracked, and an untracked
        // session is one that never expires — so fail closed instead.
        if (!user.id) {
          return null;
        }
        const sid = randomUUID();
        token.userId = user.id;
        token.username = user.username;
        token.displayName = user.displayName;
        token.role = user.role;
        token.defaultTankId = user.defaultTankId;
        token.siteId = user.siteId;
        token.mustChangePassword = user.mustChangePassword;
        token.sid = sid;
        await createUserSession({ sid, userId: user.id, role: user.role });
        return token;
      }

      const sid = asString(token.sid);
      // No sid: a token minted before per-role timeouts existed. Fail closed —
      // one clean re-login on deploy is the correct cost.
      if (!sid) {
        return null;
      }

      return (await resolveSessionState(sid)) === "ACTIVE" ? token : null;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: asString(token.userId),
          username: asString(token.username),
          displayName: asString(token.displayName),
          // asRole falls back to OPERATOR: a malformed token never gains privilege.
          role: asRole(token.role),
          defaultTankId: asNullableString(token.defaultTankId),
          siteId: asNullableString(token.siteId),
          mustChangePassword: asBoolean(token.mustChangePassword),
        },
      };
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const userId = asString(token?.userId);
      // Drop the activity record so the sid can never be reused, even if a copy
      // of the cookie survives somewhere.
      const sid = asString(token?.sid);
      if (sid) {
        await deleteUserSession(sid);
      }
      if (userId) {
        await recordAuditEvent({
          actorId: userId,
          action: "LOGOUT",
          entityType: "user",
          entityId: userId,
        });
      }
    },
  },
  session: {
    strategy: "jwt",
    /**
     * OUTER CEILING ONLY — not the security control. It bounds the JWT's `exp`
     * and the operator cookie's Expires, and must be generous enough for a pump
     * tablet to stay signed in across shifts. The real limits are the per-role
     * IDLE timeout and the 12-hour ABSOLUTE cap on privileged roles, both
     * enforced in the jwt callback above (see src/lib/session-policy.ts).
     */
    maxAge: SESSION_TOKEN_CEILING_SECONDS,
    updateAge: 24 * 60 * 60, // token rotation is not the expiry mechanism here
  },
  pages: {
    signIn: "/login",
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      // Auth.js stamps `expires` onto this cookie at every write and cannot be
      // told otherwise, so the persistent-vs-browser-session choice is applied
      // per role in session-cookie-policy.ts, on the way out of the auth route.
      options: {
        httpOnly: true,
        sameSite: "strict",
        secure: useSecureCookies,
        path: "/",
      },
    },
  },
  secret: env.NEXTAUTH_SECRET,
  // Required for self-hosted deployments (on-prem Windows Server).
  trustHost: true,
} satisfies NextAuthConfig;
