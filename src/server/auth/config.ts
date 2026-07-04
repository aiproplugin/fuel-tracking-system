import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { loginInputSchema } from "@/lib/validation";
import { clientIpFromHeaders } from "@/server/context/request-context";
import { loginRateLimiter } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/services/audit.service";
import { verifyUserCredentials } from "@/server/services/user.service";

const useSecureCookies = env.NEXTAUTH_URL.startsWith("https://");

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
    jwt({ token, user }) {
      // `user` is only present on sign-in; role and tank binding are fixed
      // for the session's lifetime (reassignment requires a fresh login).
      if (user) {
        token.userId = user.id;
        token.username = user.username;
        token.displayName = user.displayName;
        token.role = user.role;
        token.defaultTankId = user.defaultTankId;
        token.siteId = user.siteId;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
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
    maxAge: 8 * 60 * 60, // one shift; short-lived by design
    updateAge: 15 * 60, // rotate the session token every 15 minutes of activity
  },
  pages: {
    signIn: "/login",
  },
  cookies: {
    sessionToken: {
      name: useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token",
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
