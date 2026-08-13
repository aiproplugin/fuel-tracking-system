import { randomUUID } from "node:crypto";
import {
  Prisma,
  type FuelType,
  type MeterType,
  type QuotaEnforcementMode,
  type QuotaPeriod,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { startOfColomboDay } from "@/lib/format";
import { formatMeter } from "@/lib/meter";
import { db } from "@/server/db";
import { computeEfficiency, isAbnormalConsumption } from "@/server/services/efficiency";
import { recordAuditEvent } from "@/server/services/audit.service";
import { type Actor } from "@/server/services/actor";
import {
  computeQuotaUsage,
  getQuotaSettings,
  hashOverrideCode,
  resolveVehicleQuota,
  type QuotaSettingsValues,
  type QuotaUsage,
  type ResolvedQuota,
} from "@/server/services/quota.service";

/**
 * FUEL ENTRY CORE — every fuel-quantity change in this file happens inside
 * ONE atomic Prisma transaction that writes exactly one stock_movement row
 * with balance_after and refreshes the tank/vehicle caches.
 *
 * Business blocks (mismatch, meter, stock) are EXPECTED outcomes and are
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
// Wrong override codes count against the operator: the 6-digit space is only
// safe because attempts are scarce (short TTL + single use + this limiter).
const overrideAttemptLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60_000 });

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
/**
 * Retained as a named alias for the fuel-entry flow. The bound tank now lives
 * on the base Actor, so this adds no fields — it documents that these
 * procedures operate on the actor's own tank.
 */
export type OperatorActor = Actor;

export interface FuelIssueReceipt {
  transactionId: string;
  plateNumber: string;
  /** Drives every unit/label on the receipt (km / hrs / kWh). */
  meterType: MeterType;
  liters: number;
  meterReading: number;
  efficiency: number | null;
  isAbnormal: boolean;
  meterOverride: boolean;
  tankName: string;
  balanceAfterLiters: number;
  issuedAt: Date;
}

/**
 * Quota position shown to the operator ("X L used of Y L this <period>") and
 * carried on quota outcomes. DISABLED = master switch off (no quota UI at
 * all — the app behaves exactly as without quotas).
 */
export interface QuotaStatusInfo {
  state: "DISABLED" | "UNLIMITED" | "EXEMPT" | "OK" | "APPROACHING" | "EXCEEDED";
  quotaLiters: number | null;
  period: QuotaPeriod | null;
  consumedLiters: number;
  remainingLiters: number | null;
  enforcementMode: QuotaEnforcementMode;
}

export type SubmitFuelIssueResult =
  | { outcome: "SUCCESS"; receipt: FuelIssueReceipt; replayed: boolean }
  | { outcome: "FUEL_TYPE_MISMATCH"; vehicleFuelType: FuelType; tankFuelType: FuelType }
  | {
      outcome: "METER_BLOCKED";
      meterType: MeterType;
      previousReading: number;
      attemptedReading: number;
    }
  | { outcome: "INSUFFICIENT_STOCK"; availableLiters: number; requestedLiters: number }
  // HARD_BLOCK mode: over-quota is refused, no override path.
  | { outcome: "QUOTA_BLOCKED"; quota: QuotaStatusInfo; requestedLiters: number }
  // WARN_OVERRIDE mode: proceeding needs a valid supervisor override code.
  | {
      outcome: "QUOTA_EXCEEDED";
      quota: QuotaStatusInfo;
      requestedLiters: number;
      codeRejected: boolean;
    };

export type VehicleLookupResult =
  | { found: false }
  | {
      found: true;
      vehicle: {
        id: string;
        plateNumber: string;
        vehicleTypeName: string;
        companyName: string;
        fuelType: FuelType;
        meterType: MeterType;
        currentMeter: number;
        lastIssueAt: Date | null;
      };
      tank: { id: string; name: string; fuelType: FuelType; currentStockLiters: number };
      fuelMatches: boolean;
      quota: QuotaStatusInfo;
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
    select: { meterReading: true, liters: true },
  });
  return previous ? { reading: previous.meterReading, liters: previous.liters.toNumber() } : null;
}

function toReceipt(
  transaction: {
    id: string;
    liters: Prisma.Decimal;
    meterReading: number;
    efficiency: Prisma.Decimal | null;
    isAbnormal: boolean;
    meterOverride: boolean;
    issuedAt: Date;
  },
  plateNumber: string,
  meterType: MeterType,
  tankName: string,
  balanceAfter: Prisma.Decimal,
): FuelIssueReceipt {
  return {
    transactionId: transaction.id,
    plateNumber,
    meterType,
    liters: transaction.liters.toNumber(),
    meterReading: transaction.meterReading,
    efficiency: transaction.efficiency?.toNumber() ?? null,
    isAbnormal: transaction.isAbnormal,
    meterOverride: transaction.meterOverride,
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
      vehicle: {
        select: { plateNumber: true, vehicleType: { select: { meterType: true } } },
      },
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
      existing.vehicle.vehicleType.meterType,
      existing.tank.name,
      existing.movement?.balanceAfter ?? new Prisma.Decimal(0),
    ),
  };
}

// ---------------------------------------------------------------------------
// Quota helpers
// ---------------------------------------------------------------------------

const QUOTA_INCLUDE = {
  vehicleType: true,
  company: { select: { name: true, defaultQuotaLiters: true, defaultQuotaPeriod: true } },
} satisfies Prisma.VehicleInclude;

function quotaDisabled(mode: QuotaEnforcementMode): QuotaStatusInfo {
  return {
    state: "DISABLED",
    quotaLiters: null,
    period: null,
    consumedLiters: 0,
    remainingLiters: null,
    enforcementMode: mode,
  };
}

/** Usage -> operator-facing quota line. quotaLiters is the effective cap (incl. top-ups). */
function toQuotaStatusInfo(usage: QuotaUsage, settings: QuotaSettingsValues): QuotaStatusInfo {
  const base = {
    quotaLiters: usage.capLiters,
    period: usage.resolved.status === "QUOTA" ? usage.resolved.period : null,
    consumedLiters: usage.consumedLiters,
    remainingLiters: usage.remainingLiters,
    enforcementMode: settings.enforcementMode,
  };
  if (usage.resolved.status === "EXEMPT") return { state: "EXEMPT", ...base };
  if (usage.resolved.status === "UNLIMITED") return { state: "UNLIMITED", ...base };
  if (usage.remainingLiters !== null && usage.remainingLiters <= 0) {
    return { state: "EXCEEDED", ...base };
  }
  return { state: usage.approaching ? "APPROACHING" : "OK", ...base };
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
    include: { vehicle: { include: QUOTA_INCLUDE } },
  });
  if (!qrToken || !qrToken.isActive || !qrToken.vehicle.isActive) {
    return { found: false };
  }

  const [lastIssue, settings] = await Promise.all([
    db.fuelTransaction.findFirst({
      where: { vehicleId: qrToken.vehicleId },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { issuedAt: true },
    }),
    getQuotaSettings(),
  ]);

  // Master switch OFF = no quota display anywhere. Enforcement mode OFF still
  // shows the position (informational only — never blocks).
  let quota = quotaDisabled(settings.enforcementMode);
  if (settings.enforcementEnabled) {
    const resolved = resolveVehicleQuota(qrToken.vehicle, settings);
    const usage = await computeQuotaUsage(qrToken.vehicle.id, resolved, settings, new Date());
    quota = toQuotaStatusInfo(usage, settings);
  }

  return {
    found: true,
    vehicle: {
      id: qrToken.vehicle.id,
      plateNumber: qrToken.vehicle.plateNumber,
      vehicleTypeName: qrToken.vehicle.vehicleType.name,
      companyName: qrToken.vehicle.company.name,
      fuelType: qrToken.vehicle.fuelType,
      meterType: qrToken.vehicle.vehicleType.meterType,
      currentMeter: qrToken.vehicle.currentMeter,
      lastIssueAt: lastIssue?.issuedAt ?? null,
    },
    tank: {
      id: tank.id,
      name: tank.name,
      fuelType: tank.fuelType,
      currentStockLiters: tank.currentStock.toNumber(),
    },
    fuelMatches: qrToken.vehicle.fuelType === tank.fuelType,
    quota,
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
  input: {
    vehicleId: string;
    idempotencyKey: string;
    liters: number;
    meterReading: number;
    overrideCode?: string;
  },
): Promise<SubmitFuelIssueResult> {
  const replayBefore = await findReplay(input.idempotencyKey, actor.id);
  if (replayBefore) return replayBefore;

  assertWithinLimit(submitLimiter, actor.id);

  const tank = await getBoundActiveTank(actor);

  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId },
    include: QUOTA_INCLUDE,
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

  // HARD BLOCK 2: meter regression (amber M6 screen; ADMIN review only).
  // A usage meter is monotonic regardless of type — km, hrs, and kWh alike.
  if (input.meterReading < vehicle.currentMeter) {
    return {
      outcome: "METER_BLOCKED",
      meterType: vehicle.vehicleType.meterType,
      previousReading: vehicle.currentMeter,
      attemptedReading: input.meterReading,
    };
  }

  const liters = new Prisma.Decimal(input.liters.toFixed(2));

  // QUOTA gate. Only active when the master switch is ON and the enforcement
  // mode is not OFF (OFF = informational only). The pre-check here gives a
  // friendly outcome; the authoritative, race-safe re-check runs inside the
  // atomic transaction below, against the ledger.
  const quotaSettings = await getQuotaSettings();
  const quotaEnforced = quotaSettings.enforcementEnabled && quotaSettings.enforcementMode !== "OFF";
  const resolvedQuota: ResolvedQuota = quotaEnforced
    ? resolveVehicleQuota(vehicle, quotaSettings)
    : { status: "UNLIMITED" };
  const quotaApplies = quotaEnforced && resolvedQuota.status === "QUOTA";

  // A valid, unused, unexpired code for THIS vehicle — resolved before the
  // transaction; consumed (single-use) inside it.
  let overrideCodeRow: { id: string; issuedById: string } | null = null;

  if (quotaApplies) {
    const usage = await computeQuotaUsage(vehicle.id, resolvedQuota, quotaSettings, new Date());
    const overQuota = usage.remainingLiters !== null && liters.greaterThan(usage.remainingLiters);

    if (overQuota && quotaSettings.enforcementMode === "HARD_BLOCK") {
      return {
        outcome: "QUOTA_BLOCKED",
        quota: toQuotaStatusInfo(usage, quotaSettings),
        requestedLiters: liters.toNumber(),
      };
    }

    if (overQuota && quotaSettings.enforcementMode === "WARN_OVERRIDE") {
      if (!input.overrideCode) {
        return {
          outcome: "QUOTA_EXCEEDED",
          quota: toQuotaStatusInfo(usage, quotaSettings),
          requestedLiters: liters.toNumber(),
          codeRejected: false,
        };
      }
      assertWithinLimit(overrideAttemptLimiter, actor.id);
      const codeRow = await db.quotaOverrideCode.findFirst({
        where: {
          vehicleId: vehicle.id,
          codeHash: hashOverrideCode(input.overrideCode),
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, issuedById: true },
      });
      if (!codeRow) {
        return {
          outcome: "QUOTA_EXCEEDED",
          quota: toQuotaStatusInfo(usage, quotaSettings),
          requestedLiters: liters.toNumber(),
          codeRejected: true,
        };
      }
      overrideCodeRow = codeRow;
    }
  }

  // Friendly pre-check; the in-transaction guard is the real gate.
  if (tank.currentStock.lessThan(liters)) {
    return {
      outcome: "INSUFFICIENT_STOCK",
      availableLiters: tank.currentStock.toNumber(),
      requestedLiters: liters.toNumber(),
    };
  }

  const previousFill = await getPreviousFill(vehicle.id);
  const efficiency = computeEfficiency(input.meterReading, previousFill);
  const isAbnormal = isAbnormalConsumption(efficiency, {
    minEfficiency: vehicle.vehicleType.minEfficiency.toNumber(),
    maxEfficiency: vehicle.vehicleType.maxEfficiency.toNumber(),
  });

  let txResult;
  try {
    txResult = await db.$transaction(async (tx) => {
      // Authoritative quota gate: re-derive consumption from the ledger
      // INSIDE the transaction so concurrent fills cannot slip past the cap,
      // and consume the single-use override code with a guarded update.
      let quotaOverrideById: string | null = null;
      if (quotaApplies) {
        const usageNow = await computeQuotaUsage(
          vehicle.id,
          resolvedQuota,
          quotaSettings,
          new Date(),
          tx,
        );
        const overQuota =
          usageNow.remainingLiters !== null && liters.greaterThan(usageNow.remainingLiters);
        if (overQuota) {
          if (quotaSettings.enforcementMode === "HARD_BLOCK") {
            return { kind: "quotaBlocked" as const, usage: usageNow };
          }
          if (!overrideCodeRow) {
            return { kind: "quotaExceeded" as const, usage: usageNow, codeRejected: false };
          }
          const codeGuard = await tx.quotaOverrideCode.updateMany({
            where: { id: overrideCodeRow.id, usedAt: null },
            data: { usedAt: new Date() },
          });
          if (codeGuard.count === 0) {
            // The code lost a race to another submission — single use stands.
            return { kind: "quotaExceeded" as const, usage: usageNow, codeRejected: true };
          }
          quotaOverrideById = overrideCodeRow.issuedById;
        }
      }

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
          meterReading: input.meterReading,
          previousMeterReading: vehicle.currentMeter,
          efficiency: efficiency !== null ? new Prisma.Decimal(efficiency.toFixed(2)) : null,
          isAbnormal,
          quotaOverride: quotaOverrideById !== null,
          quotaOverrideById,
          issuedAt: new Date(),
        },
      });

      if (quotaOverrideById !== null && overrideCodeRow) {
        await tx.quotaOverrideCode.update({
          where: { id: overrideCodeRow.id },
          data: { usedInTransactionId: transaction.id },
        });
      }

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
        data: { currentMeter: input.meterReading },
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

  if (txResult.kind === "quotaBlocked") {
    return {
      outcome: "QUOTA_BLOCKED",
      quota: toQuotaStatusInfo(txResult.usage, quotaSettings),
      requestedLiters: liters.toNumber(),
    };
  }
  if (txResult.kind === "quotaExceeded") {
    return {
      outcome: "QUOTA_EXCEEDED",
      quota: toQuotaStatusInfo(txResult.usage, quotaSettings),
      requestedLiters: liters.toNumber(),
      codeRejected: txResult.codeRejected,
    };
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
      meterReading: input.meterReading,
      isAbnormal,
    },
  });

  if (txResult.transaction.quotaOverride && overrideCodeRow) {
    await recordAuditEvent({
      actorId: actor.id,
      action: "QUOTA_OVERRIDE",
      entityType: "fuel_transaction",
      entityId: txResult.transaction.id,
      after: {
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        liters: liters.toNumber(),
        authorizedById: overrideCodeRow.issuedById,
        overrideCodeId: overrideCodeRow.id,
      },
    });
  }

  return {
    outcome: "SUCCESS",
    replayed: false,
    receipt: toReceipt(
      txResult.transaction,
      vehicle.plateNumber,
      vehicle.vehicleType.meterType,
      tank.name,
      txResult.balanceAfter,
    ),
  };
}

/**
 * Operator "flag for admin review" after an M6 meter block. Records the
 * blocked submission (including liters — the fuel already left the tank) as
 * a PENDING exception. No ledger write happens here.
 */
export async function flagMeterException(
  actor: OperatorActor,
  input: { vehicleId: string; attemptedReading: number; liters: number },
): Promise<{ exceptionId: string }> {
  const tank = await getBoundActiveTank(actor);
  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle || !vehicle.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Vehicle not found." });
  }

  const exception = await db.meterException.create({
    data: {
      vehicleId: vehicle.id,
      tankId: tank.id,
      operatorId: actor.id,
      liters: new Prisma.Decimal(input.liters.toFixed(2)),
      previousReading: vehicle.currentMeter,
      attemptedReading: input.attemptedReading,
    },
  });

  await recordAuditEvent({
    actorId: actor.id,
    action: "METER_EXCEPTION_FLAGGED",
    entityType: "meter_exception",
    entityId: exception.id,
    after: {
      vehicleId: vehicle.id,
      previousReading: vehicle.currentMeter,
      attemptedReading: input.attemptedReading,
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
      include: {
        vehicle: {
          select: { plateNumber: true, vehicleType: { select: { meterType: true } } },
        },
      },
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
      meterType: transaction.vehicle.vehicleType.meterType,
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
      vehicle: {
        select: { plateNumber: true, vehicleType: { select: { meterType: true } } },
      },
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
      meterType: row.vehicle.vehicleType.meterType,
      tankName: row.tank.name,
      operatorName: row.operator.displayName,
      liters: row.liters.toNumber(),
      meterReading: row.meterReading,
      efficiency: row.efficiency?.toNumber() ?? null,
      isAbnormal: row.isAbnormal,
      meterOverride: row.meterOverride,
      issuedAt: row.issuedAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Pending exception queue + recent decisions (supervisor scoped, read-only). */
export async function listMeterExceptions(actor: Actor) {
  const scope = tankScopeWhere(actor);
  const vehicleSelect = {
    select: { plateNumber: true, vehicleType: { select: { meterType: true } } },
  } as const;
  const [pending, recentReviewed] = await Promise.all([
    db.meterException.findMany({
      where: { status: "PENDING", ...scope },
      orderBy: { createdAt: "asc" },
      include: {
        vehicle: vehicleSelect,
        tank: { select: { name: true } },
        operator: { select: { displayName: true } },
      },
    }),
    db.meterException.findMany({
      where: { status: { not: "PENDING" }, ...scope },
      orderBy: { reviewedAt: "desc" },
      take: 10,
      include: {
        vehicle: vehicleSelect,
        operator: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
    }),
  ]);

  return {
    pending: pending.map((row) => ({
      id: row.id,
      plateNumber: row.vehicle.plateNumber,
      meterType: row.vehicle.vehicleType.meterType,
      tankName: row.tank.name,
      operatorName: row.operator.displayName,
      liters: row.liters.toNumber(),
      previousReading: row.previousReading,
      attemptedReading: row.attemptedReading,
      createdAt: row.createdAt,
    })),
    recentReviewed: recentReviewed.map((row) => ({
      id: row.id,
      plateNumber: row.vehicle.plateNumber,
      meterType: row.vehicle.vehicleType.meterType,
      operatorName: row.operator.displayName,
      status: row.status,
      correctedReading: row.correctedReading,
      reviewedByName: row.reviewedBy?.displayName ?? null,
      reviewedAt: row.reviewedAt,
    })),
  };
}

/**
 * ADMIN-only exception review (D6). APPROVE completes the blocked issue in
 * one atomic transaction — fuel_transaction with meter_override=true +
 * ledger movement + caches — because the fuel physically left the tank when
 * the operator dispensed it. REJECT records the decision and touches
 * nothing else.
 */
export async function reviewMeterException(
  adminId: string,
  input: {
    exceptionId: string;
    decision: "APPROVE" | "REJECT";
    correctedReading?: number;
    reason: string;
  },
) {
  const exception = await db.meterException.findUnique({
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
    const guard = await db.meterException.updateMany({
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
      action: "METER_EXCEPTION_REVIEWED",
      entityType: "meter_exception",
      entityId: exception.id,
      after: { decision: "REJECT", reason: input.reason },
    });
    return { decision: "REJECT" as const };
  }

  const corrected = input.correctedReading;
  if (corrected === undefined) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Corrected meter reading is required." });
  }
  if (corrected < exception.vehicle.currentMeter) {
    const currentFormatted = formatMeter(
      exception.vehicle.currentMeter,
      exception.vehicle.vehicleType.meterType,
    );
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Corrected reading must be at least the vehicle's current reading (${currentFormatted}).`,
    });
  }

  const previousFill = await getPreviousFill(exception.vehicleId);
  const efficiency = computeEfficiency(corrected, previousFill);
  const isAbnormal = isAbnormalConsumption(efficiency, {
    minEfficiency: exception.vehicle.vehicleType.minEfficiency.toNumber(),
    maxEfficiency: exception.vehicle.vehicleType.maxEfficiency.toNumber(),
  });

  const txResult = await db.$transaction(async (tx) => {
    const statusGuard = await tx.meterException.updateMany({
      where: { id: exception.id, status: "PENDING" },
      data: {
        status: "APPROVED",
        correctedReading: corrected,
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
        meterReading: corrected,
        previousMeterReading: exception.vehicle.currentMeter,
        meterOverride: true,
        overrideReason: input.reason,
        overrideByUserId: adminId,
        efficiency: efficiency !== null ? new Prisma.Decimal(efficiency.toFixed(2)) : null,
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
      data: { currentMeter: corrected },
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
    action: "METER_OVERRIDE",
    entityType: "fuel_transaction",
    entityId: txResult.transactionId,
    after: {
      exceptionId: exception.id,
      correctedReading: corrected,
      reason: input.reason,
      liters: exception.liters.toNumber(),
    },
  });
  await recordAuditEvent({
    actorId: adminId,
    action: "METER_EXCEPTION_REVIEWED",
    entityType: "meter_exception",
    entityId: exception.id,
    after: { decision: "APPROVE", transactionId: txResult.transactionId },
  });

  return { decision: "APPROVE" as const, transactionId: txResult.transactionId };
}
