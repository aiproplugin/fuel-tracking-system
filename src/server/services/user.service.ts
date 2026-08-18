import type { Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { type FuelTypeName } from "@/lib/fuel";
import { logger } from "@/lib/logger";
import type { Permission } from "@/lib/permissions";
import { computeLockedUntil, isLocked } from "@/server/auth/lockout-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/security/rate-limit";
import { recordAuditEvent } from "@/server/services/audit.service";
import { resolveActorPermissions } from "@/server/services/permission.service";

/** Shape returned to Auth.js on successful authentication. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  defaultTankId: string | null;
  siteId: string | null;
  /** True while an admin-set temporary password is in force. */
  mustChangePassword: boolean;
}

/** What the authenticated landing page needs (Phase 1 placeholder). */
export interface UserHomeContext {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /**
   * The user's RESOLVED effective permissions — role bundle plus grants, minus
   * denials. This is what the UI must gate controls on: `role` alone is wrong
   * the moment a per-user override exists, in both directions (a granted
   * permission would never light up its control, a denied one would keep it).
   *
   * Resolved by the SAME resolveActorPermissions the permissionProcedure gate
   * uses, so the client and the server can never disagree about what is held.
   * UI visibility only — the server re-resolves and enforces on every call.
   */
  permissions: Permission[];
  siteName: string | null;
  defaultTank: {
    id: string;
    name: string;
    fuelType: FuelTypeName;
    currentStockLiters: number;
    capacityLiters: number;
  } | null;
}

/**
 * Timing-equalization hash: when the username does not exist (or the account
 * is locked/inactive) we still verify the password against a real argon2id
 * hash so response time cannot distinguish "unknown user" from "wrong
 * password". Computed once per process, lazily.
 */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`dummy-${crypto.randomUUID()}`);
  return dummyHashPromise;
}

/**
 * Verify a username/password pair with lockout/backoff and audit logging.
 *
 * Behavior (all failure modes return null — callers surface ONE generic
 * error message, never the reason):
 * - unknown username        -> dummy verify (timing equalization), audit, null
 * - locked or inactive user -> dummy verify, audit, null (no counter change)
 * - wrong password          -> increment counter, lock at threshold with
 *                              exponential backoff, audit, null
 * - success                 -> reset counter/lock, stamp last_login_at,
 *                              audit, return AuthenticatedUser
 */
export async function verifyUserCredentials(input: {
  username: string;
  password: string;
  ipAddress: string | null;
}): Promise<AuthenticatedUser | null> {
  const now = new Date();
  const normalizedUsername = input.username.trim().toLowerCase();

  const user = await db.user.findUnique({ where: { username: normalizedUsername } });

  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    // Attempted username deliberately not stored (could be a mistyped password).
    await recordAuditEvent({
      action: "LOGIN_FAILURE",
      entityType: "user",
      ipAddress: input.ipAddress,
    });
    return null;
  }

  if (!user.isActive || isLocked(user.lockedUntil, now)) {
    await verifyPassword(await getDummyHash(), input.password);
    await recordAuditEvent({
      actorId: user.id,
      action: "LOGIN_FAILURE",
      entityType: "user",
      entityId: user.id,
      after: { reason: user.isActive ? "locked" : "inactive" },
      ipAddress: input.ipAddress,
    });
    return null;
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);

  if (!passwordMatches) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil = computeLockedUntil(failedLoginCount, now);
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount, lockedUntil },
    });
    await recordAuditEvent({
      actorId: user.id,
      action: "LOGIN_FAILURE",
      entityType: "user",
      entityId: user.id,
      after: { failedLoginCount },
      ipAddress: input.ipAddress,
    });
    if (lockedUntil) {
      await recordAuditEvent({
        actorId: user.id,
        action: "ACCOUNT_LOCKED",
        entityType: "user",
        entityId: user.id,
        after: { failedLoginCount, lockedUntil: lockedUntil.toISOString() },
        ipAddress: input.ipAddress,
      });
      logger.warn(
        { userId: user.id, failedLoginCount },
        "Account locked after repeated failed logins",
      );
    }
    return null;
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
  await recordAuditEvent({
    actorId: user.id,
    action: "LOGIN_SUCCESS",
    entityType: "user",
    entityId: user.id,
    ipAddress: input.ipAddress,
  });

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    defaultTankId: user.defaultTankId,
    siteId: user.siteId,
    mustChangePassword: user.mustChangePassword,
  };
}

/** Guarded: 5 attempts / 15 min per user (current-password brute-force). */
const passwordChangeRateLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

/**
 * User changes their OWN password (also clears the admin-set temporary
 * flag). Requires the current password; the new one must satisfy the policy
 * (enforced by the input schema) and differ from the current one. Audited
 * as PASSWORD_CHANGED — never the password or hash.
 */
export async function changeOwnPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const rate = passwordChangeRateLimiter.consume(input.userId);
  if (!rate.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Try again later.",
    });
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });

  const currentMatches = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!currentMatches) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
  }

  const sameAsCurrent = await verifyPassword(user.passwordHash, input.newPassword);
  if (sameAsCurrent) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The new password must be different from the current one.",
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.user.update({
    where: { id: input.userId },
    data: {
      passwordHash,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await recordAuditEvent({
    actorId: input.userId,
    action: "PASSWORD_CHANGED",
    entityType: "user",
    entityId: input.userId,
  });
}

/**
 * Landing-page context: identity plus the operator's bound tank (with the
 * cached stock level). Decimals are converted to numbers at this boundary so
 * no Prisma types leak to the client.
 */
export async function getUserHomeContext(userId: string): Promise<UserHomeContext> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      site: { select: { name: true } },
      defaultTank: {
        select: {
          id: true,
          name: true,
          fuelType: true,
          currentStock: true,
          capacityLiters: true,
        },
      },
    },
  });

  // One source of truth with permissionProcedure: same resolver, same rows.
  const permissions = await resolveActorPermissions(db, user.id, user.role);

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    permissions: [...permissions],
    siteName: user.site?.name ?? null,
    defaultTank: user.defaultTank
      ? {
          id: user.defaultTank.id,
          name: user.defaultTank.name,
          fuelType: user.defaultTank.fuelType,
          currentStockLiters: user.defaultTank.currentStock.toNumber(),
          capacityLiters: user.defaultTank.capacityLiters.toNumber(),
        }
      : null,
  };
}
