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
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    displayName: string;
    role: Role;
    defaultTankId: string | null;
    siteId: string | null;
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
  }
}
