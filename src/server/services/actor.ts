import type { Role } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

/**
 * The authenticated principal as seen by services. Constructed from the
 * session by the tRPC middleware — services never trust client-supplied
 * identity — and carries the RESOLVED effective permissions for the request.
 *
 * `permissions` is the authority for every access decision. `role` remains on
 * the actor for audit context and for the last-admin guards, but must NOT be
 * used to decide what an actor may do or see: a per-user override can put a
 * user's real access anywhere relative to their role's defaults.
 */
export interface Actor {
  id: string;
  role: Role;
  siteId: string | null;
  /**
   * The operator's bound tank. Fuel is always issued from it and never from a
   * client-supplied tank; the fuel.issue permission is only assignable to a
   * user who has one (guardrail), so it is non-null wherever fuel.issue holds.
   */
  defaultTankId: string | null;
  permissions: ReadonlySet<Permission>;
}

/** Does this actor hold the permission? The one place that question is asked. */
export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

/**
 * Site-scoping where-fragment, driven by the actor's REPORT SCOPE permission
 * rather than their role, so a per-user override genuinely widens or narrows
 * what they see.
 *
 * Precedence: report.view.all > report.view.site > neither.
 *  - report.view.all  → every site
 *  - report.view.site → the actor's own site only
 *  - neither          → a sentinel that matches nothing (fails CLOSED)
 *
 * Unchanged for users without overrides: SUPERVISOR holds report.view.site and
 * stays pinned to their own site; MANAGER/ADMIN hold report.view.all and see
 * everything. A supervisor without a site still sees nothing.
 */
export function siteScopeWhere(actor: Actor): { siteId?: string } {
  if (actor.permissions.has("report.view.all")) {
    return {};
  }
  if (actor.permissions.has("report.view.site")) {
    return { siteId: actor.siteId ?? "__none__" };
  }
  return { siteId: "__none__" };
}

/**
 * Resolve the site a query should be constrained to, honouring an optionally
 * client-supplied `siteId`.
 *
 * SECURITY: an actor limited to their own site is always pinned to it and any
 * requested `siteId` is IGNORED — never trusted. Only report.view.all may
 * narrow to an arbitrary site or span all sites (`undefined`). An actor with
 * neither scope permission resolves to a sentinel matching nothing.
 *
 * Returns `undefined` for "all sites" so callers can spread it into a `where`.
 */
export function effectiveSiteId(actor: Actor, requestedSiteId?: string | null): string | undefined {
  if (actor.permissions.has("report.view.all")) {
    return requestedSiteId ?? undefined;
  }
  if (actor.permissions.has("report.view.site")) {
    return actor.siteId ?? "__none__";
  }
  return "__none__";
}
