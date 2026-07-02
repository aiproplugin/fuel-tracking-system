import type { Role } from "@prisma/client";
import { logger } from "@/lib/logger";
import { computeLockedUntil, isLocked } from "@/server/auth/lockout-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/** Shape returned to Auth.js on successful authentication. */
export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  defaultTankId: string | null;
  siteId: string | null;
}

/** What the authenticated landing page needs (Phase 1 placeholder). */
export interface UserHomeContext {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  siteName: string | null;
  defaultTank: {
    id: string;
    name: string;
    fuelType: "PETROL" | "DIESEL";
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
  };
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

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
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
