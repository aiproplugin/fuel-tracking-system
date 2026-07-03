import { randomUUID } from "node:crypto";
import { Prisma, type FuelType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { startOfColomboDay } from "@/lib/format";
import { db } from "@/server/db";
import { computeKmPerLiter, isAbnormalConsumption } from "@/server/services/efficiency";
import { recordAuditEvent } from "@/server/services/audit.service";
import { type Actor } from "@/server/services/actor";

/**
 * FUEL ENTRY CORE — every fuel-quantity change in this file happens inside
 * ONE atomic Prisma transaction that writes exactly one stock_movement row
 * with balance_after and refreshes the tank/vehicle caches.
 *
 * Business blocks (mismatch, odometer, stock) are EXPECTED outcomes and are
 * returned as a typed result union, not thrown — the operator UI maps them
 * to the M6/M7 screens. System failures still throw.
 */

// ---------------------------------------------------------------------------
// Rate limiting (per operator id; in-memory, single-node — see security.md)
// ---------------------------------------------------------------------------

import { createRateLimiter } from "@/server/security/rate-limit";

const scanLookupLimiter = createRateLimiter({ limit: 30, windowMs: 5 * 60_000 });
const manualLookupLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60_000 });
const submitLimiter = createRateLimiter({ limit: 20, windowMs: 5 * 60_000 });

function assertWithinLimit(limiter: ReturnType<typeof createRateLimiter>, key: string) {
  if (!limiter.consume(key).allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many attempts. Wait a few minutes and try again.",
    });
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Operator identity + the session-bound tank. The client never sends a tank. */
export interface OperatorActor extends Actor {
  defaultTankId: string | null;
}

export interface FuelIssueReceipt {
  transactionId: string;
  plateNumber: string;
  liters: number;
  odometer: number;
  kmPerLiter: number | null;
  isAbnormal: boolean;
  odometerOverride: boolean;
  tankName: string;
  balanceAfterLiters: number;
  issuedAt: Date;
}

export type SubmitFuelIssueResult =
  | { outcome: "SUCCESS"; receipt: FuelIssueReceipt; replayed: boolean }
  | { outcome: "FUEL_TYPE_MISMATCH"; vehicleFuelType: FuelType; tankFuelType: FuelType }
  | { outcome: "ODOMETER_BLOCKED"; previousOdometer: number; attemptedOdometer: number }
  | { outcome: "INSUFFICIENT_STOCK"; availableLiters: number; requestedLiters: number };

export type VehicleLookupResult =
  | { found: false }
  | {
      found: true;
      vehicle: {
        id: string;
        plateNumber: string;
        vehicleTypeName: string;
        fuelType: FuelType;
        currentOdometer: number;
        lastIssueAt: Date | null;
      };
      tank: { id: string; name: string; fuelType: FuelType; currentStockLiters: number };
      fuelMatches: boolean;
    };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function getBoundActiveTank(actor: OperatorActor) {
  if (!actor.defaultTankId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No tank is assigned to your account. Contact an administrator.",
    });
  }
  const tank = await db.tank.findUnique({ where: { id: actor.defaultTankId } });
  if (!tank || !tank.isActive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Your assigned tank is unavailable. Contact an administrator.",
    });
  }
  return tank;
}

/** Latest fill for a vehicle = the efficiency baseline. */
async function getPreviousFill(vehicleId: string) {
  const previous = await db.fuelTransaction.findFirst({
    where: { vehicleId },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    select: { odometer: true, liters: true },
  });
  return previous ? { odometer: previous.odometer, liters: previous.liters.toNumber() } : null;
}

function toReceipt(
  transaction: {
    id: string;
    liters: Prisma.Decimal;
    odometer: number;
    kmPerLiter: Prisma.Decimal | null;
    isAbnormal: boolean;
    odometerOverride: boolean;
    issuedAt: Date;
  },
  plateNumber: string,
  tankName: string,
  balanceAfter: Prisma.Decimal,
): FuelIssueReceipt {
  return {
    transactionId: transaction.id,
    plateNumber,
    liters: transaction.liters.toNumber(),
    odometer: transaction.odometer,
    kmPerLiter: transaction.kmPerLiter?.toNumber() ?? null,
    isAbnormal: transaction.isAbnormal,
    odometerOverride: transaction.odometerOverride,
    tankName,
    balanceAfterLiters: balanceAfter.toNumber(),
    issuedAt: transaction.issuedAt,
  };
}

/** Replay lookup for idempotent retries; enforces same-operator ownership. */
async function findReplay(idempotencyKey: string, actorId: string) {
  const existing = await db.fuelTransaction.findUnique({
    where: { idempotencyKey },
    include: {
      vehicle: { select: { plateNumber: true } },
      tank: { select: { name: true } },
      movement: { select: { balanceAfter: true } },
    },
  });
  if (!existing) return null;
  if (existing.operatorId !== actorId) {
    // A key collision across operators is practically impossible with UUIDs;
    // treat it as a hard conflict rather than leaking another user's receipt.
    throw new TRPCError({ code: "CONFLICT", message: "Idempotency key conflict." });
  }
  return {
    outcome: "SUCCESS" as const,
    replayed: true,
    receipt: toReceipt(
      existing,
      existing.vehicle.plateNumber,
      existing.tank.name,
      existing.movement?.balanceAfter ?? new Prisma.Decimal(0),
    ),
  };
}

// ---------------------------------------------------------------------------
// Operator flow
// ---------------------------------------------------------------------------

/**
 * Token -> vehicle lookup for the scan flow. The plate is revealed ONLY on
 * a successful active-token match; unknown/inactive tokens return a uniform
 * { found: false }. Manual entry is rate-limited harder than camera scans.
 */
export async function lookupVehicleForIssue(
  actor: OperatorActor,
  input: { token: string; manual: boolean },
): Promise<VehicleLookupResult> {
  assertWithinLimit(input.manual ? manualLookupLimiter : scanLookupLimiter, actor.id);

  const tank = await getBoundActiveTank(actor);

  const qrToken = await db.qrToken.findUnique({
    where: { token: input.token },
    include: {
      vehicle: { include: { vehicleType: { select: { name: true } } } },
    },
  });
  if (!qrToken || !qrToken.isActive || !qrToken.vehicle.isActive) {
    return { found: false };
  }

  const lastIssue = await db.fuelTransaction.findFirst({
    where: { vehicleId: qrToken.vehicleId },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    select: { issuedAt: true },
  });

  return {
    found: true,
    vehicle: {
      id: qrToken.vehicle.id,
      plateNumber: qrToken.vehicle.plateNumber,
      vehicleTypeName: qrToken.vehicle.vehicleType.name,
      fuelType: qrToken.vehicle.fuelType,
      currentOdometer: qrToken.vehicle.currentOdometer,
      lastIssueAt: lastIssue?.issuedAt ?? null,
    },
    tank: {
      id: tank.id,
      name: tank.name,
      fuelType: tank.fuelType,
      currentStockLiters: tank.currentStock.toNumber(),
    },
    fuelMatches: qrToken.vehicle.fuelType === tank.fuelType,
  };
}

/**
 * THE core write. Validates every rule server-side, then commits the
 * transaction + ledger row + caches atomically. The guarded decrement
 * (updateMany with currentStock >= liters) makes concurrent submissions on
 * one tank race-safe without raw SQL: the row lock serializes them and the
 * loser of an emptied tank gets INSUFFICIENT_STOCK, never a negative balance.
 */
export async function submitFuelIssue(
  actor: OperatorActor,
  input: { vehicleId: string; idempotencyKey: string; liters: number; odometer: number },
): Promise<SubmitFuelIssueResult> {
  const replayBefore = await findReplay(input.idempotencyKey, actor.id);
  if (replayBefore) return replayBefore;

  assertWithinLimit(submitLimiter, actor.id);

  const tank = await getBoundActiveTank(actor);

  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId },
    include: { vehicleType: true },
  });
  if (!vehicle || !vehicle.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  // HARD BLOCK 1: fuel type mismatch (red M7 screen; no override exists).
  if (vehicle.fuelType !== tank.fuelType) {
    return {
      outcome: "FUEL_TYPE_MISMATCH",
      vehicleFuelType: vehicle.fuelType,
      tankFuelType: tank.fuelType,
    };
  }

  // HARD BLOCK 2: odometer regression (amber M6 screen; ADMIN review only).
  if (input.odometer < vehicle.currentOdometer) {
    return {
      outcome: "ODOMETER_BLOCKED",
      previousOdometer: vehicle.currentOdometer,
      attemptedOdometer: input.odometer,
    };
  }

  const liters = new Prisma.Decimal(input.liters.toFixed(2));

  // Friendly pre-check; the in-transaction guard is the real gate.
  if (tank.currentStock.lessThan(liters)) {
    return {
      outcome: "INSUFFICIENT_STOCK",
      availableLiters: tank.currentStock.toNumber(),
      requestedLiters: liters.toNumber(),
    };
  }

  const previousFill = await getPreviousFill(vehicle.id);
  const kmPerLiter = computeKmPerLiter(input.odometer, previousFill);
  const isAbnormal = isAbnormalConsumption(kmPerLiter, {
    minKmPerLiter: vehicle.vehicleType.minKmPerLiter.toNumber(),
    maxKmPerLiter: vehicle.vehicleType.maxKmPerLiter.toNumber(),
  });

  let txResult;
  try {
    txResult = await db.$transaction(async (tx) => {
      const guard = await tx.tank.updateMany({
        where: { id: tank.id, isActive: true, currentStock: { gte: liters } },
        data: { currentStock: { decrement: liters } },
      });
      if (guard.count === 0) {
        return { kind: "insufficient" as const };
      }
      const updatedTank = await tx.tank.findUniqueOrThrow({
        where: { id: tank.id },
        select: { currentStock: true },
      });

      const transaction = await tx.fuelTransaction.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          vehicleId: vehicle.id,
          tankId: tank.id,
          operatorId: actor.id,
          liters,
          odometer: input.odometer,
          previousOdometer: vehicle.currentOdometer,
          kmPerLiter: kmPerLiter !== null ? new Prisma.Decimal(kmPerLiter.toFixed(2)) : null,
          isAbnormal,
          issuedAt: new Date(),
        },
      });

      await tx.stockMovement.create({
        data: {
          tankId: tank.id,
          type: "ISSUE",
          quantity: liters.negated(),
          balanceAfter: updatedTank.currentStock,
          fuelTransactionId: transaction.id,
          createdById: actor.id,
        },
      });

      await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { currentOdometer: input.odometer },
      });

      return { kind: "created" as const, transaction, balanceAfter: updatedTank.currentStock };
    });
  } catch (error) {
    // Concurrent duplicate submit: the unique idempotency_key lost the race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replayAfter = await findReplay(input.idempotencyKey, actor.id);
      if (replayAfter) return replayAfter;
    }
    throw error;
  }

  if (txResult.kind === "insufficient") {
    const freshTank = await db.tank.findUniqueOrThrow({
      where: { id: tank.id },
      select: { currentStock: true },
    });
    return {
      outcome: "INSUFFICIENT_STOCK",
      availableLiters: freshTank.currentStock.toNumber(),
      requestedLiters: liters.toNumber(),
    };
  }

  await recordAuditEvent({
    actorId: actor.id,
    action: "FUEL_ISSUED",
    entityType: "fuel_transaction",
    entityId: txResult.transaction.id,
    after: {
      vehicleId: vehicle.id,
      tankId: tank.id,
      liters: liters.toNumber(),
      odometer: input.odometer,
      isAbnormal,
    },
  });

  return {
    outcome: "SUCCESS",
    replayed: false,
    receipt: toReceipt(txResult.transaction, vehicle.plateNumber, tank.name, txResult.balanceAfter),
  };
}

/**
 * Operator "flag for admin review" after an M6 odometer block. Records the
 * blocked submission (including liters — the fuel already left the tank) as
 * a PENDING exception. No ledger write happens here.
 */
export async function flagOdometerException(
  actor: OperatorActor,
  input: { vehicleId: string; attemptedOdometer: number; liters: number },
): Promise<{ exceptionId: string }> {
  const tank = await getBoundActiveTank(actor);
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle || !vehicle.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  const exception = await db.odometerException.create({
    data: {
      vehicleId: vehicle.id,
      tankId: tank.id,
      operatorId: actor.id,
      liters: new Prisma.Decimal(input.liters.toFixed(2)),
      previousOdometer: vehicle.currentOdometer,
      attemptedOdometer: input.attemptedOdometer,
    },
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "ODOMETER_EXCEPTION_FLAGGED",
    entityType: "odometer_exception",
    entityId: exception.id,
    after: {
      vehicleId: vehicle.id,
      previousOdometer: vehicle.currentOdometer,
      attemptedOdometer: input.attemptedOdometer,
      liters: input.liters,
    },
  });

  return { exceptionId: exception.id };
}

/** M2 home data: bound tank, today's Colombo-day stats, recent issues. */
export async function getOperatorDay(actor: OperatorActor) {
  if (!actor.defaultTankId) {
    return { tank: null, todayIssueCount: 0, todayLiters: 0, todayAbnormal: 0, recent: [] };
  }
  const tank = await db.tank.findUnique({ where: { id: actor.defaultTankId } });
  if (!tank) {
    return { tank: null, todayIssueCount: 0, todayLiters: 0, todayAbnormal: 0, recent: [] };
  }

  const todayStart = startOfColomboDay(new Date());
  const [aggregate, abnormalCount, recent] = await Promise.all([
    db.fuelTransaction.aggregate({
      where: { tankId: tank.id, issuedAt: { gte: todayStart } },
      _count: { id: true },
      _sum: { liters: true },
    }),
    db.fuelTransaction.count({
      where: { tankId: tank.id, issuedAt: { gte: todayStart }, isAbnormal: true },
    }),
    db.fuelTransaction.findMany({
      where: { tankId: tank.id },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: 5,
      include: { vehicle: { select: { plateNumber: true } } },
    }),
  ]);

  return {
    tank: {
      id: tank.id,
      name: tank.name,
      fuelType: tank.fuelType,
      currentStockLiters: tank.currentStock.toNumber(),
      lowStockThreshold: tank.lowStockThreshold.toNumber(),
    },
    todayIssueCount: aggregate._count.id,
    todayLiters: aggregate._sum.liters?.toNumber() ?? 0,
    todayAbnormal: abnormalCount,
    recent: recent.map((transaction) => ({
      id: transaction.id,
      plateNumber: transaction.vehicle.plateNumber,
      liters: transaction.liters.toNumber(),
      issuedAt: transaction.issuedAt,
      isAbnormal: transaction.isAbnormal,
    })),
  };
}

// ---------------------------------------------------------------------------
// Admin / supervisor views + review
// ---------------------------------------------------------------------------

function tankScopeWhere(actor: Actor) {
  return actor.role === "SUPERVISOR" ? { tank: { siteId: actor.siteId ?? "__none__" } } : {};
}

/** Paginated register (supervisor scoped to own site's tanks). */
export async function listFuelIssues(
  actor: Actor,
  input: { cursor?: string | null; limit: number },
) {
  const rows = await db.fuelTransaction.findMany({
    where: tankScopeWhere(actor),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      vehicle: { select: { plateNumber: true } },
      tank: { select: { name: true } },
      operator: { select: { displayName: true } },
    },
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    issues: page.map((row) => ({
      id: row.id,
      plateNumber: row.vehicle.plateNumber,
      tankName: row.tank.name,
      operatorName: row.operator.displayName,
      liters: row.liters.toNumber(),
      odometer: row.odometer,
      kmPerLiter: row.kmPerLiter?.toNumber() ?? null,
      isAbnormal: row.isAbnormal,
      odometerOverride: row.odometerOverride,
      issuedAt: row.issuedAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Pending exception queue + recent decisions (supervisor scoped, read-only). */
export async function listOdometerExceptions(actor: Actor) {
  const scope = tankScopeWhere(actor);
  const [pending, recentReviewed] = await Promise.all([
    db.odometerException.findMany({
      where: { status: "PENDING", ...scope },
      orderBy: { createdAt: "asc" },
      include: {
        vehicle: { select: { plateNumber: true } },
        tank: { select: { name: true } },
        operator: { select: { displayName: true } },
      },
    }),
    db.odometerException.findMany({
      where: { status: { not: "PENDING" }, ...scope },
      orderBy: { reviewedAt: "desc" },
      take: 10,
      include: {
        vehicle: { select: { plateNumber: true } },
        operator: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
    }),
  ]);

  return {
    pending: pending.map((row) => ({
      id: row.id,
      plateNumber: row.vehicle.plateNumber,
      tankName: row.tank.name,
      operatorName: row.operator.displayName,
      liters: row.liters.toNumber(),
      previousOdometer: row.previousOdometer,
      attemptedOdometer: row.attemptedOdometer,
      createdAt: row.createdAt,
    })),
    recentReviewed: recentReviewed.map((row) => ({
      id: row.id,
      plateNumber: row.vehicle.plateNumber,
      operatorName: row.operator.displayName,
      status: row.status,
      correctedOdometer: row.correctedOdometer,
      reviewedByName: row.reviewedBy?.displayName ?? null,
      reviewedAt: row.reviewedAt,
    })),
  };
}

/**
 * ADMIN-only exception review (D6). APPROVE completes the blocked issue in
 * one atomic transaction — fuel_transaction with odometer_override=true +
 * ledger movement + caches — because the fuel physically left the tank when
 * the operator dispensed it. REJECT records the decision and touches
 * nothing else.
 */
export async function reviewOdometerException(
  adminId: string,
  input: {
    exceptionId: string;
    decision: "APPROVE" | "REJECT";
    correctedOdometer?: number;
    reason: string;
  },
) {
  const exception = await db.odometerException.findUnique({
    where: { id: input.exceptionId },
    include: {
      vehicle: { include: { vehicleType: true } },
      tank: true,
    },
  });
  if (!exception) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Exception not found." });
  }
  if (exception.status !== "PENDING") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This exception has already been reviewed.",
    });
  }

  if (input.decision === "REJECT") {
    const guard = await db.odometerException.updateMany({
      where: { id: exception.id, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewedById: adminId,
        reviewReason: input.reason,
        reviewedAt: new Date(),
      },
    });
    if (guard.count === 0) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This exception has already been reviewed.",
      });
    }
    await recordAuditEvent({
      actorId: adminId,
      action: "ODOMETER_EXCEPTION_REVIEWED",
      entityType: "odometer_exception",
      entityId: exception.id,
      after: { decision: "REJECT", reason: input.reason },
    });
    return { decision: "REJECT" as const };
  }

  const corrected = input.correctedOdometer;
  if (corrected === undefined) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Corrected odometer is required." });
  }
  if (corrected < exception.vehicle.currentOdometer) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Corrected odometer must be at least the vehicle's current reading (${exception.vehicle.currentOdometer} km).`,
    });
  }

  const previousFill = await getPreviousFill(exception.vehicleId);
  const kmPerLiter = computeKmPerLiter(corrected, previousFill);
  const isAbnormal = isAbnormalConsumption(kmPerLiter, {
    minKmPerLiter: exception.vehicle.vehicleType.minKmPerLiter.toNumber(),
    maxKmPerLiter: exception.vehicle.vehicleType.maxKmPerLiter.toNumber(),
  });

  const txResult = await db.$transaction(async (tx) => {
    const statusGuard = await tx.odometerException.updateMany({
      where: { id: exception.id, status: "PENDING" },
      data: {
        status: "APPROVED",
        correctedOdometer: corrected,
        reviewedById: adminId,
        reviewReason: input.reason,
        reviewedAt: new Date(),
      },
    });
    if (statusGuard.count === 0) {
      return { kind: "alreadyReviewed" as const };
    }

    const stockGuard = await tx.tank.updateMany({
      where: { id: exception.tankId, isActive: true, currentStock: { gte: exception.liters } },
      data: { currentStock: { decrement: exception.liters } },
    });
    if (stockGuard.count === 0) {
      // Roll the whole review back — stock must be corrected first (Phase 4).
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Insufficient recorded stock to post this issue. Reconcile the tank first.",
      });
    }
    const updatedTank = await tx.tank.findUniqueOrThrow({
      where: { id: exception.tankId },
      select: { currentStock: true },
    });

    const transaction = await tx.fuelTransaction.create({
      data: {
        idempotencyKey: randomUUID(),
        vehicleId: exception.vehicleId,
        tankId: exception.tankId,
        operatorId: exception.operatorId,
        liters: exception.liters,
        odometer: corrected,
        previousOdometer: exception.vehicle.currentOdometer,
        odometerOverride: true,
        overrideReason: input.reason,
        overrideByUserId: adminId,
        kmPerLiter: kmPerLiter !== null ? new Prisma.Decimal(kmPerLiter.toFixed(2)) : null,
        isAbnormal,
        issuedAt: exception.createdAt, // the fuel left the tank when flagged
      },
    });

    await tx.stockMovement.create({
      data: {
        tankId: exception.tankId,
        type: "ISSUE",
        quantity: exception.liters.negated(),
        balanceAfter: updatedTank.currentStock,
        fuelTransactionId: transaction.id,
        createdById: adminId,
      },
    });

    await tx.vehicle.update({
      where: { id: exception.vehicleId },
      data: { currentOdometer: corrected },
    });

    return { kind: "approved" as const, transactionId: transaction.id };
  });

  if (txResult.kind === "alreadyReviewed") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This exception has already been reviewed.",
    });
  }

  await recordAuditEvent({
    actorId: adminId,
    action: "ODOMETER_OVERRIDE",
    entityType: "fuel_transaction",
    entityId: txResult.transactionId,
    after: {
      exceptionId: exception.id,
      correctedOdometer: corrected,
      reason: input.reason,
      liters: exception.liters.toNumber(),
    },
  });
  await recordAuditEvent({
    actorId: adminId,
    action: "ODOMETER_EXCEPTION_REVIEWED",
    entityType: "odometer_exception",
    entityId: exception.id,
    after: { decision: "APPROVE", transactionId: txResult.transactionId },
  });

  return { decision: "APPROVE" as const, transactionId: txResult.transactionId };
}
