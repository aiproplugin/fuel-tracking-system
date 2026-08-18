import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * Session/JWT type augmentation: the fields bound at login and trusted by
 * tRPC authorization middleware. JWT fields are optional because the raw
 * token exists before our jwt() callback populates it.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      displayName: string;
      role: Role;
      defaultTankId: string | null;
      siteId: string | null;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    displayName: string;
    role: Role;
    defaultTankId: string | null;
    siteId: string | null;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    username?: string;
    displayName?: string;
    role?: Role;
    defaultTankId?: string | null;
    siteId?: string | null;
    mustChangePassword?: boolean;
    /**
     * Opaque per-sign-in session id, minted in the jwt callback and joined to
     * the `user_session` row that carries this session's last activity. A token
     * without one is rejected (it predates per-role session timeouts).
     */
    sid?: string;
  }
}
