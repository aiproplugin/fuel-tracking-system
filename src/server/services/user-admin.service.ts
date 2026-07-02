import { Prisma, type Role } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * ADMIN-only user management. Every mutation is audited; password hashes
 * never appear in audit payloads or return values.
 */

export async function listUsers() {
  const users = await db.user.findMany({
    orderBy: { username: "asc" },
    include: {
      site: { select: { id: true, name: true } },
      defaultTank: { select: { id: true, name: true, fuelType: true } },
    },
  });
  const now = new Date();
  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    site: user.site,
    defaultTank: user.defaultTank,
    isLocked: user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime(),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  }));
}

export async function createUser(
  actorId: string,
  input: {
    username: string;
    password: string;
    displayName: string;
    role: Role;
    siteId: string | null;
  },
) {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await db.user.create({
      data: {
        username: input.username.toLowerCase(),
        passwordHash,
        displayName: input.displayName,
        role: input.role,
        siteId: input.siteId,
        // The admin-chosen password is temporary by design: the user must
        // replace it at first sign-in, so the admin never knows the
        // long-term credential.
        mustChangePassword: true,
      },
    });
    await recordAuditEvent({
      actorId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: user.id,
      after: { username: user.username, role: user.role, siteId: input.siteId },
    });
    await recordAuditEvent({
      actorId,
      action: "PASSWORD_SET",
      entityType: "user",
      entityId: user.id,
      after: { temporary: true },
    });
    return { id: user.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new TRPCError({ code: "CONFLICT", message: "This username is already taken." });
    }
    throw error;
  }
}

/** Guard: the system must always keep at least one active ADMIN. */
async function assertNotLastActiveAdmin(userId: string, next: { role: Role; isActive: boolean }) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  const losesAdmin =
    target.role === "ADMIN" && target.isActive && (next.role !== "ADMIN" || !next.isActive);
  if (losesAdmin) {
    const otherActiveAdmins = await db.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: userId } },
    });
    if (otherActiveAdmins === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cannot remove or deactivate the last active administrator.",
      });
    }
  }
  return target;
}

export async function updateUser(
  actorId: string,
  input: {
    id: string;
    displayName: string;
    role: Role;
    siteId: string | null;
    isActive: boolean;
  },
) {
  const before = await assertNotLastActiveAdmin(input.id, {
    role: input.role,
    isActive: input.isActive,
  });

  await db.user.update({
    where: { id: input.id },
    data: {
      displayName: input.displayName,
      role: input.role,
      siteId: input.siteId,
      isActive: input.isActive,
      // An operator moving to another role loses the tank binding.
      ...(input.role !== "OPERATOR" ? { defaultTankId: null } : {}),
    },
  });

  const roleChanged = before.role !== input.role;
  await recordAuditEvent({
    actorId,
    action: roleChanged ? "ROLE_CHANGED" : "USER_UPDATED",
    entityType: "user",
    entityId: input.id,
    before: { role: before.role, siteId: before.siteId, isActive: before.isActive },
    after: { role: input.role, siteId: input.siteId, isActive: input.isActive },
  });
}

/**
 * Assign or clear an operator's bound tank (ADMIN only — the core of the
 * tank-binding rule). Takes effect at the operator's NEXT login because the
 * binding lives in the session JWT.
 */
export async function assignTank(
  actorId: string,
  input: { userId: string; tankId: string | null },
) {
  const target = await db.user.findUnique({
    where: { id: input.userId },
    include: { defaultTank: { select: { id: true, name: true } } },
  });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  if (target.role !== "OPERATOR") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Only operators can be assigned a tank.",
    });
  }

  let tankName: string | null = null;
  if (input.tankId) {
    const tank = await db.tank.findUnique({ where: { id: input.tankId } });
    if (!tank || !tank.isActive) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Tank not found or inactive." });
    }
    tankName = tank.name;
  }

  await db.user.update({
    where: { id: input.userId },
    data: { defaultTankId: input.tankId },
  });

  await recordAuditEvent({
    actorId,
    action: "TANK_ASSIGNED",
    entityType: "user",
    entityId: input.userId,
    before: { tankId: target.defaultTankId, tankName: target.defaultTank?.name ?? null },
    after: { tankId: input.tankId, tankName },
  });
}

/**
 * ADMIN password reset: sets a TEMPORARY password the user must replace at
 * next sign-in. Clears lockout state. Audited as PASSWORD_RESET — the
 * password and hash never appear in audit payloads, logs, or responses.
 * Note: with JWT sessions an existing session stays valid until it expires
 * or the user signs out (documented in docs/security.md).
 */
export async function resetPassword(
  actorId: string,
  input: { userId: string; newPassword: string },
) {
  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.user.update({
    where: { id: input.userId },
    data: {
      passwordHash,
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await recordAuditEvent({
    actorId,
    action: "PASSWORD_RESET",
    entityType: "user",
    entityId: input.userId,
    after: { temporary: true },
  });
}

/** ADMIN unlock: clears the failed-login counter and lock expiry. Audited. */
export async function unlockUser(actorId: string, input: { userId: string }) {
  const target = await db.user.findUnique({ where: { id: input.userId } });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
  }
  await db.user.update({
    where: { id: input.userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await recordAuditEvent({
    actorId,
    action: "USER_UPDATED",
    entityType: "user",
    entityId: input.userId,
    before: { lockedUntil: target.lockedUntil?.toISOString() ?? null },
    after: { unlocked: true },
  });
}
