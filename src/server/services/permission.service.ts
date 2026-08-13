import type { PrismaClient, Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import {
  PERMISSIONS,
  PERMISSION_CONFIG,
  explainPermissions,
  isPermission,
  resolveEffectivePermissions,
  validateOverrides,
  type Permission,
  type PermissionOverrideInput,
  type RoleName,
} from "@/lib/permissions";
import { db } from "@/server/db";
import type { Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Permission resolution and administration.
 *
 * RESOLUTION IS PER REQUEST, never cached in the session. The JWT fixes a
 * user's role at sign-in, so baking permissions into it would leave a revoked
 * permission live until the session expired. Reading the (indexed, tiny)
 * override rows on each protected call means a denial takes effect on the very
 * next request — which is the point of having a denial.
 */

/** Just enough of the session user to build an Actor. */
export interface SessionPrincipal {
  id: string;
  role: Role;
  siteId: string | null;
  defaultTankId: string | null;
}

/**
 * Resolve a user's effective permissions from their role plus stored
 * overrides. The pure resolution rule lives in src/lib/permissions.ts; this
 * function only supplies it with rows.
 *
 * Fails CLOSED: if the override rows cannot be read, the error propagates
 * rather than defaulting to the role bundle.
 */
export async function resolveActorPermissions(
  client: Pick<PrismaClient, "userPermissionOverride">,
  userId: string,
  role: Role,
): Promise<ReadonlySet<Permission>> {
  const overrides = await client.userPermissionOverride.findMany({
    where: { userId },
    select: { permission: true, mode: true },
  });
  return resolveEffectivePermissions(role as RoleName, overrides);
}

/** Build the request's Actor, with effective permissions attached. */
export async function buildActor(
  client: Pick<PrismaClient, "userPermissionOverride">,
  principal: SessionPrincipal,
): Promise<Actor> {
  const permissions = await resolveActorPermissions(client, principal.id, principal.role);
  return {
    id: principal.id,
    role: principal.role,
    siteId: principal.siteId,
    defaultTankId: principal.defaultTankId,
    permissions,
  };
}

/**
 * Throw FORBIDDEN unless the actor holds the permission. Used by the tRPC
 * middleware and by the binary export route, so both enforce identically.
 */
export function assertPermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.has(permission)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

// ---------------------------------------------------------------------------
// Administration (requires permission.manage — gated at the router)
// ---------------------------------------------------------------------------

export interface UserAccessDetail {
  userId: string;
  username: string;
  displayName: string;
  role: RoleName;
  isActive: boolean;
  hasDefaultTank: boolean;
  isLastActiveAdmin: boolean;
  /** Every catalogue permission with its provenance — never ambiguous. */
  permissions: Array<{
    permission: Permission;
    label: string;
    description: string;
    group: string;
    source: "role" | "granted" | "denied" | "none";
    held: boolean;
    /** Grant widens which sites' data the user can see. */
    widensDataVisibility: boolean;
    /** Reserved to the ADMIN role; never grantable by override. */
    adminOnly: boolean;
    /** Reason and author recorded when the override was created. */
    override: { mode: "GRANT" | "DENY"; reason: string; grantedBy: string; createdAt: Date } | null;
  }>;
}

/** Is this the only remaining active ADMIN? Mirrors the user-admin guard. */
async function isLastActiveAdmin(userId: string, role: Role): Promise<boolean> {
  if (role !== "ADMIN") return false;
  const others = await db.user.count({
    where: { role: "ADMIN", isActive: true, id: { not: userId } },
  });
  return others === 0;
}

/**
 * Full access detail for one user: role, resolved effective permissions, and
 * the SOURCE of each one. The Access Management page renders this directly —
 * showing the resolved set with provenance is what keeps permissions
 * unambiguous.
 */
export async function getUserAccess(userId: string): Promise<UserAccessDetail> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      permissionOverrides: {
        include: { grantedBy: { select: { displayName: true } } },
      },
    },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  const role = user.role as RoleName;
  const sources = explainPermissions(role, user.permissionOverrides);
  const overrideByPermission = new Map(
    user.permissionOverrides
      .filter((row) => isPermission(row.permission))
      .map((row) => [row.permission, row]),
  );

  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role,
    isActive: user.isActive,
    hasDefaultTank: user.defaultTankId !== null,
    isLastActiveAdmin: await isLastActiveAdmin(user.id, user.role),
    permissions: PERMISSIONS.map((permission) => {
      const config = PERMISSION_CONFIG[permission];
      const source = sources[permission];
      const row = overrideByPermission.get(permission);
      return {
        permission,
        label: config.label,
        description: config.description,
        group: config.group,
        source,
        held: source === "role" || source === "granted",
        widensDataVisibility: config.widensDataVisibility === true,
        adminOnly: permission === "user.manage" || permission === "permission.manage",
        override: row
          ? {
              mode: row.mode,
              reason: row.reason,
              grantedBy: row.grantedBy.displayName,
              createdAt: row.createdAt,
            }
          : null,
      };
    }),
  };
}

/** Compact list for the Access Management index. */
export async function listUserAccess() {
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    include: { permissionOverrides: { select: { permission: true, mode: true } } },
  });

  return users.map((user) => {
    const effective = resolveEffectivePermissions(user.role as RoleName, user.permissionOverrides);
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role as RoleName,
      isActive: user.isActive,
      effectiveCount: effective.size,
      grantCount: user.permissionOverrides.filter((row) => row.mode === "GRANT").length,
      denyCount: user.permissionOverrides.filter((row) => row.mode === "DENY").length,
    };
  });
}

/**
 * Load the facts the guardrails need about a target user, then validate a
 * PROPOSED end state. Every write path funnels through here so no code path
 * can save an override that breaks an invariant.
 */
async function assertProposedStateIsSafe(input: {
  userId: string;
  role: RoleName;
  overrides: readonly PermissionOverrideInput[];
}): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, defaultTankId: true },
  });
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  const violation = validateOverrides({
    role: input.role,
    overrides: input.overrides,
    hasDefaultTank: user.defaultTankId !== null,
    // Evaluated against the user's CURRENT role: a user who is an admin today
    // must not be able to lose access-control permissions while they are the
    // last one, whether by override or by a simultaneous role change.
    isLastActiveAdmin: await isLastActiveAdmin(user.id, user.role),
  });

  if (violation) {
    throw new TRPCError({ code: "BAD_REQUEST", message: violation.message });
  }
}

/** The override rows a user will have after applying one change. */
async function projectedOverrides(
  userId: string,
  change: { permission: Permission; mode: "GRANT" | "DENY" } | { permission: Permission; remove: true },
): Promise<PermissionOverrideInput[]> {
  const existing = await db.userPermissionOverride.findMany({
    where: { userId },
    select: { permission: true, mode: true },
  });
  const kept = existing.filter((row) => row.permission !== change.permission);
  return "remove" in change ? kept : [...kept, { permission: change.permission, mode: change.mode }];
}

/**
 * Create or replace one override (ADMIN, permission.manage).
 *
 * Validated against the RESULTING effective set, so the segregation-of-duties
 * and meta-permission invariants cannot be sidestepped by ordering changes.
 */
export async function setPermissionOverride(
  actor: Actor,
  input: { userId: string; permission: Permission; mode: "GRANT" | "DENY"; reason: string },
) {
  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true },
  });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  await assertProposedStateIsSafe({
    userId: input.userId,
    role: target.role as RoleName,
    overrides: await projectedOverrides(input.userId, {
      permission: input.permission,
      mode: input.mode,
    }),
  });

  await db.userPermissionOverride.upsert({
    where: { userId_permission: { userId: input.userId, permission: input.permission } },
    update: { mode: input.mode, reason: input.reason, grantedById: actor.id },
    create: {
      userId: input.userId,
      permission: input.permission,
      mode: input.mode,
      reason: input.reason,
      grantedById: actor.id,
    },
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: input.mode === "GRANT" ? "PERMISSION_GRANTED" : "PERMISSION_DENIED",
    entityType: "user",
    entityId: input.userId,
    after: { permission: input.permission, mode: input.mode, reason: input.reason },
  });

  return { ok: true as const };
}

/** Remove an override, returning the user to their role default for it. */
export async function removePermissionOverride(
  actor: Actor,
  input: { userId: string; permission: Permission; reason: string },
) {
  const existing = await db.userPermissionOverride.findUnique({
    where: { userId_permission: { userId: input.userId, permission: input.permission } },
  });
  if (!existing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such override." });
  }

  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true },
  });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  // Removing a DENY can re-expose a role permission and re-create a conflict,
  // so removal is validated exactly like a grant.
  await assertProposedStateIsSafe({
    userId: input.userId,
    role: target.role as RoleName,
    overrides: await projectedOverrides(input.userId, {
      permission: input.permission,
      remove: true,
    }),
  });

  await db.userPermissionOverride.delete({
    where: { userId_permission: { userId: input.userId, permission: input.permission } },
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "PERMISSION_OVERRIDE_REMOVED",
    entityType: "user",
    entityId: input.userId,
    before: { permission: input.permission, mode: existing.mode, reason: existing.reason },
    after: { reason: input.reason },
  });

  return { ok: true as const };
}

/**
 * Change a user's role (ADMIN, permission.manage).
 *
 * The new role is validated against the user's EXISTING overrides: a role
 * change alone can create a segregation-of-duties conflict (e.g. demoting a
 * stock.adjust holder to OPERATOR, who then also holds fuel.issue) or strand a
 * meta-permission grant on a non-admin.
 */
export async function changeUserRole(
  actor: Actor,
  input: { userId: string; role: RoleName; reason: string },
) {
  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true, isActive: true },
  });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }

  // Never strand the system without an administrator.
  if (target.role === "ADMIN" && input.role !== "ADMIN") {
    const others = await db.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: input.userId } },
    });
    if (others === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot change the role of the last active administrator.",
      });
    }
  }

  const overrides = await db.userPermissionOverride.findMany({
    where: { userId: input.userId },
    select: { permission: true, mode: true },
  });
  await assertProposedStateIsSafe({ userId: input.userId, role: input.role, overrides });

  await db.user.update({ where: { id: input.userId }, data: { role: input.role } });

  await recordAuditEvent({
    actorId: actor.id,
    action: "ROLE_CHANGED",
    entityType: "user",
    entityId: input.userId,
    before: { role: target.role },
    after: { role: input.role, reason: input.reason },
  });

  return { ok: true as const };
}
