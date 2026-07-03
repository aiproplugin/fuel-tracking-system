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

/**
 * Resolve the site a query should be constrained to, honouring an optionally
 * client-supplied `siteId`. SECURITY: a SUPERVISOR is always pinned to their
 * own site and any requested `siteId` is IGNORED — never trusted. MANAGER/ADMIN
 * may narrow to one site, or see all (`undefined`). A supervisor without a site
 * resolves to a sentinel that matches nothing (fails closed).
 *
 * Returns `undefined` for "all sites" so callers can spread it into a `where`.
 */
export function effectiveSiteId(actor: Actor, requestedSiteId?: string | null): string | undefined {
  if (actor.role === "SUPERVISOR") {
    return actor.siteId ?? "__none__";
  }
  return requestedSiteId ?? undefined;
}
