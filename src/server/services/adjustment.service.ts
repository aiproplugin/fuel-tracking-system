import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { type AdjustmentReasonName } from "@/lib/adjustment-reason";
import { db } from "@/server/db";
import { type Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Stock adjustments — signed corrections with a mandatory reason, captured as
 * BOTH a standardised category (for loss-by-cause reporting) and free-text
 * detail (for the specifics). Neither is optional; the schema enforces both
 * server-side and the category is descriptive only — no guard, movement, or
 * balance below reads it.
 *
 * Authority per CLAUDE.md: SUPERVISOR (own site) or ADMIN; MANAGER is
 * explicitly excluded (router allowlist). Guards keep the ledger sane:
 * a negative adjustment cannot drive stock below zero, a positive one
 * cannot exceed capacity.
 */

export interface AdjustmentRecord {
  id: string;
  tankName: string;
  quantityChange: number;
  balanceAfterLiters: number;
  replayed: boolean;
}

export type CreateAdjustmentResult =
  | { outcome: "SUCCESS"; adjustment: AdjustmentRecord }
  | { outcome: "INSUFFICIENT_STOCK"; currentStockLiters: number; requestedChange: number }
  | {
      outcome: "OVER_CAPACITY";
      capacityLiters: number;
      currentStockLiters: number;
      requestedChange: number;
    };

async function findAdjustmentReplay(idempotencyKey: string, actorId: string) {
  const existing = await db.stockAdjustment.findUnique({
    where: { idempotencyKey },
    include: {
      tank: { select: { name: true } },
      movement: { select: { balanceAfter: true } },
    },
  });
  if (!existing) return null;
  if (existing.adjustedById !== actorId) {
    throw new TRPCError({ code: "CONFLICT", message: "Idempotency key conflict." });
  }
  return {
    outcome: "SUCCESS" as const,
    adjustment: {
      id: existing.id,
      tankName: existing.tank.name,
      quantityChange: existing.quantityChange.toNumber(),
      balanceAfterLiters: existing.movement?.balanceAfter.toNumber() ?? 0,
      replayed: true,
    },
  };
}

export async function createAdjustment(
  actor: Actor,
  input: {
    tankId: string;
    idempotencyKey: string;
    quantityChange: number;
    reasonCategory: AdjustmentReasonName;
    reason: string;
  },
): Promise<CreateAdjustmentResult> {
  const replayBefore = await findAdjustmentReplay(input.idempotencyKey, actor.id);
  if (replayBefore) return replayBefore;

  const tank = await db.tank.findUnique({ where: { id: input.tankId } });
  if (!tank || !tank.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tank not found or inactive." });
  }
  if (actor.role === "SUPERVISOR" && tank.siteId !== actor.siteId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This tank is outside your site." });
  }

  const change = new Prisma.Decimal(input.quantityChange.toFixed(2));
  const isNegative = change.isNegative();

  // Friendly pre-checks; the in-transaction guards are the real gates.
  if (isNegative && tank.currentStock.plus(change).isNegative()) {
    return {
      outcome: "INSUFFICIENT_STOCK",
      currentStockLiters: tank.currentStock.toNumber(),
      requestedChange: change.toNumber(),
    };
  }
  if (!isNegative && tank.currentStock.plus(change).greaterThan(tank.capacityLiters)) {
    return {
      outcome: "OVER_CAPACITY",
      capacityLiters: tank.capacityLiters.toNumber(),
      currentStockLiters: tank.currentStock.toNumber(),
      requestedChange: change.toNumber(),
    };
  }

  let txResult;
  try {
    txResult = await db.$transaction(async (tx) => {
      const guard = await tx.tank.updateMany({
        where: {
          id: tank.id,
          isActive: true,
          currentStock: isNegative
            ? { gte: change.negated() } // enough stock to remove
            : { lte: tank.capacityLiters.minus(change) }, // room to add
        },
        data: { currentStock: { increment: change } },
      });
      if (guard.count === 0) {
        return { kind: "guarded" as const };
      }
      const updatedTank = await tx.tank.findUniqueOrThrow({
        where: { id: tank.id },
        select: { currentStock: true },
      });

      const adjustment = await tx.stockAdjustment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          tankId: tank.id,
          adjustedById: actor.id,
          quantityChange: change,
          reasonCategory: input.reasonCategory,
          reason: input.reason,
          adjustedAt: new Date(),
        },
      });

      await tx.stockMovement.create({
        data: {
          tankId: tank.id,
          type: "ADJUSTMENT",
          quantity: change,
          balanceAfter: updatedTank.currentStock,
          adjustmentId: adjustment.id,
          createdById: actor.id,
        },
      });

      return { kind: "created" as const, adjustment, balanceAfter: updatedTank.currentStock };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replayAfter = await findAdjustmentReplay(input.idempotencyKey, actor.id);
      if (replayAfter) return replayAfter;
    }
    throw error;
  }

  if (txResult.kind === "guarded") {
    const fresh = await db.tank.findUniqueOrThrow({
      where: { id: tank.id },
      select: { currentStock: true, capacityLiters: true },
    });
    return isNegative
      ? {
          outcome: "INSUFFICIENT_STOCK",
          currentStockLiters: fresh.currentStock.toNumber(),
          requestedChange: change.toNumber(),
        }
      : {
          outcome: "OVER_CAPACITY",
          capacityLiters: fresh.capacityLiters.toNumber(),
          currentStockLiters: fresh.currentStock.toNumber(),
          requestedChange: change.toNumber(),
        };
  }

  await recordAuditEvent({
    actorId: actor.id,
    action: "ADJUSTMENT_RECORDED",
    entityType: "stock_adjustment",
    entityId: txResult.adjustment.id,
    after: {
      tankId: tank.id,
      quantityChange: change.toNumber(),
      // Both halves of the reason land in the trail: the category makes the
      // audit itself analysable, the detail keeps it specific.
      reasonCategory: input.reasonCategory,
      reason: input.reason,
    },
  });

  return {
    outcome: "SUCCESS",
    adjustment: {
      id: txResult.adjustment.id,
      tankName: tank.name,
      quantityChange: change.toNumber(),
      balanceAfterLiters: txResult.balanceAfter.toNumber(),
      replayed: false,
    },
  };
}

/** Paginated register (supervisor scoped to own site's tanks). */
export async function listAdjustments(
  actor: Actor,
  input: { cursor?: string | null; limit: number },
) {
  const rows = await db.stockAdjustment.findMany({
    where: actor.role === "SUPERVISOR" ? { tank: { siteId: actor.siteId ?? "__none__" } } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      tank: { select: { name: true } },
      adjustedBy: { select: { displayName: true } },
      movement: { select: { balanceAfter: true } },
    },
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    adjustments: page.map((row) => ({
      id: row.id,
      tankName: row.tank.name,
      adjustedByName: row.adjustedBy.displayName,
      quantityChange: row.quantityChange.toNumber(),
      reasonCategory: row.reasonCategory,
      reason: row.reason,
      balanceAfterLiters: row.movement?.balanceAfter.toNumber() ?? null,
      adjustedAt: row.adjustedAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
