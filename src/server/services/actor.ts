import type { Role } from "@prisma/client";

/**
 * The authenticated principal as seen by services. Constructed from the
 * session by routers — services never trust client-supplied identity.
 */
export interface Actor {
  id: string;
  role: Role;
  siteId: string | null;
}

/**
 * Site-scoping where-fragment: ADMIN/MANAGER see everything, SUPERVISOR only
 * their own site. (OPERATOR never reaches these services — router gates.)
 * A supervisor without a site sees nothing rather than everything.
 */
export function siteScopeWhere(actor: Actor): { siteId?: string } {
  if (actor.role === "SUPERVISOR") {
    return { siteId: actor.siteId ?? "__none__" };
  }
  return {};
}
