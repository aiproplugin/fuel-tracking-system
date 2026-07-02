import NextAuth from "next-auth";
import { authConfig } from "./config";

/**
 * Auth.js entry point. `auth()` is the single way server code reads the
 * current session (tRPC context, server components, route handlers).
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
