import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { env } from "@/lib/env";
import { loginInputSchema } from "@/lib/validation";

const useSecureCookies = env.NEXTAUTH_URL.startsWith("https://");

/**
 * Auth.js v5 configuration — Phase 0 stub.
 *
 * The Credentials provider validates input shape but ALWAYS returns null
 * (no user store exists yet). Phase 1 replaces the authorize body with a
 * Prisma user lookup + argon2id verification (see ./password.ts), lockout/
 * backoff, and audit logging. Returning null yields Auth.js's generic
 * CredentialsSignin error — no user enumeration.
 */
export const authConfig = {
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = loginInputSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }
        // Phase 1: db lookup + verifyPassword(user.passwordHash, parsed.data.password)
        return null;
      },
    }),
  ],
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
