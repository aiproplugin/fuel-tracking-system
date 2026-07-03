import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { type Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * Deliveries — fuel IN. Create authority is SUPERVISOR (own site) or ADMIN
 * only (router-gated; site scope re-checked here). No operator path by
 * design: deliveries increase stock and carry a higher control risk than
 * issues (docs/security.md).
 *
 * One atomic $transaction per delivery: header + exactly one DELIVERY
 * movement (+liters, balance_after) + cache update. The guarded update
 * (currentStock <= capacity - liters) blocks over-capacity without raw SQL.
 */

export interface DeliveryRecord {
  id: string;
  tankName: string;
  liters: number;
  balanceAfterLiters: number;
  deliveredAt: Date;
  replayed: boolean;
}

export type CreateDeliveryResult =
  | { outcome: "SUCCESS"; delivery: DeliveryRecord }
  | {
      outcome: "OVER_CAPACITY";
      capacityLiters: number;
      currentStockLiters: number;
      requestedLiters: number;
    };

async function assertTankInScope(actor: Actor, tankId: string) {
  const tank = await db.tank.findUnique({
    where: { id: tankId },
    include: { site: { select: { name: true } } },
  });
  if (!tank || !tank.isActive) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tank not found or inactive." });
  }
  if (actor.role === "SUPERVISOR" && tank.siteId !== actor.siteId) {
    // Ownership check: a supervisor may only touch tanks on their own site.
    throw new TRPCError({ code: "FORBIDDEN", message: "This tank is outside your site." });
  }
  return tank;
}

async function findDeliveryReplay(idempotencyKey: string, actorId: string) {
  const existing = await db.delivery.findUnique({
    where: { idempotencyKey },
    include: {
      tank: { select: { name: true } },
      movement: { select: { balanceAfter: true } },
    },
  });
  if (!existing) return null;
  if (existing.receivedById !== actorId) {
    throw new TRPCError({ code: "CONFLICT", message: "Idempotency key conflict." });
  }
  return {
    outcome: "SUCCESS" as const,
    delivery: {
      id: existing.id,
      tankName: existing.tank.name,
      liters: existing.liters.toNumber(),
      balanceAfterLiters: existing.movement?.balanceAfter.toNumber() ?? 0,
      deliveredAt: existing.deliveredAt,
      replayed: true,
    },
  };
}

export async function createDelivery(
  actor: Actor,
  input: {
    tankId: string;
    idempotencyKey: string;
    liters: number;
    supplierName?: string;
    referenceNo?: string;
    deliveredAt: Date;
  },
): Promise<CreateDeliveryResult> {
  const replayBefore = await findDeliveryReplay(input.idempotencyKey, actor.id);
  if (replayBefore) return replayBefore;

  const tank = await assertTankInScope(actor, input.tankId);
  const liters = new Prisma.Decimal(input.liters.toFixed(2));

  // Friendly pre-check; the in-transaction guard is the real gate.
  if (tank.currentStock.plus(liters).greaterThan(tank.capacityLiters)) {
    return {
      outcome: "OVER_CAPACITY",
      capacityLiters: tank.capacityLiters.toNumber(),
      currentStockLiters: tank.currentStock.toNumber(),
      requestedLiters: liters.toNumber(),
    };
  }

  let txResult;
  try {
    txResult = await db.$transaction(async (tx) => {
      const guard = await tx.tank.updateMany({
        where: {
          id: tank.id,
          isActive: true,
          currentStock: { lte: tank.capacityLiters.minus(liters) },
        },
        data: { currentStock: { increment: liters } },
      });
      if (guard.count === 0) {
        return { kind: "overCapacity" as const };
      }
      const updatedTank = await tx.tank.findUniqueOrThrow({
        where: { id: tank.id },
        select: { currentStock: true },
      });

      const delivery = await tx.delivery.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          tankId: tank.id,
          receivedById: actor.id,
          liters,
          supplierName: input.supplierName,
          referenceNo: input.referenceNo,
          deliveredAt: input.deliveredAt,
        },
      });

      await tx.stockMovement.create({
        data: {
          tankId: tank.id,
          type: "DELIVERY",
          quantity: liters,
          balanceAfter: updatedTank.currentStock,
          deliveryId: delivery.id,
          createdById: actor.id,
        },
      });

      return { kind: "created" as const, delivery, balanceAfter: updatedTank.currentStock };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replayAfter = await findDeliveryReplay(input.idempotencyKey, actor.id);
      if (replayAfter) return replayAfter;
    }
    throw error;
  }

  if (txResult.kind === "overCapacity") {
    const fresh = await db.tank.findUniqueOrThrow({
      where: { id: tank.id },
      select: { currentStock: true, capacityLiters: true },
    });
    return {
      outcome: "OVER_CAPACITY",
      capacityLiters: fresh.capacityLiters.toNumber(),
      currentStockLiters: fresh.currentStock.toNumber(),
      requestedLiters: liters.toNumber(),
    };
  }

  await recordAuditEvent({
    actorId: actor.id,
    action: "DELIVERY_RECORDED",
    entityType: "delivery",
    entityId: txResult.delivery.id,
    after: {
      tankId: tank.id,
      liters: liters.toNumber(),
      referenceNo: input.referenceNo ?? null,
      deliveredAt: input.deliveredAt.toISOString(),
    },
  });

  return {
    outcome: "SUCCESS",
    delivery: {
      id: txResult.delivery.id,
      tankName: tank.name,
      liters: liters.toNumber(),
      balanceAfterLiters: txResult.balanceAfter.toNumber(),
      deliveredAt: txResult.delivery.deliveredAt,
      replayed: false,
    },
  };
}

/** Paginated register (supervisor scoped to own site's tanks). */
export async function listDeliveries(
  actor: Actor,
  input: { cursor?: string | null; limit: number },
) {
  const rows = await db.delivery.findMany({
    where: actor.role === "SUPERVISOR" ? { tank: { siteId: actor.siteId ?? "__none__" } } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      tank: { select: { name: true } },
      receivedBy: { select: { displayName: true } },
      movement: { select: { balanceAfter: true } },
    },
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  return {
    deliveries: page.map((row) => ({
      id: row.id,
      tankName: row.tank.name,
      receivedByName: row.receivedBy.displayName,
      liters: row.liters.toNumber(),
      supplierName: row.supplierName,
      referenceNo: row.referenceNo,
      balanceAfterLiters: row.movement?.balanceAfter.toNumber() ?? null,
      deliveredAt: row.deliveredAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
