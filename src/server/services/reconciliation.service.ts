import { TRPCError } from "@trpc/server";
import { db } from "@/server/db";
import { siteScopeWhere, type Actor } from "@/server/services/actor";
import { recordAuditEvent } from "@/server/services/audit.service";
import { analyzeTankLedger, type TankLedgerAnalysis } from "@/server/services/reconciliation-core";

/**
 * Reconciliation — proves the sacred-ledger invariant on demand. The ledger
 * is the source of truth; the tank cache is repairable, the ledger never is.
 */

export interface TankReconciliation extends TankLedgerAnalysis {
  tankId: string;
  tankName: string;
  siteName: string;
}

export async function runReconciliation(actor: Actor): Promise<{
  tanks: TankReconciliation[];
  matchedCount: number;
  totalCount: number;
}> {
  const tanks = await db.tank.findMany({
    where: siteScopeWhere(actor),
    orderBy: { name: "asc" },
    include: { site: { select: { name: true } } },
  });

  const results: TankReconciliation[] = [];
  for (const tank of tanks) {
    const movements = await db.stockMovement.findMany({
      where: { tankId: tank.id },
      orderBy: { id: "asc" },
      select: { id: true, quantity: true, balanceAfter: true },
    });
    const analysis = analyzeTankLedger(
      movements.map((movement) => ({
        id: movement.id,
        quantity: movement.quantity.toNumber(),
        balanceAfter: movement.balanceAfter.toNumber(),
      })),
      tank.currentStock.toNumber(),
    );
    results.push({
      tankId: tank.id,
      tankName: tank.name,
      siteName: tank.site.name,
      ...analysis,
    });
  }

  return {
    tanks: results,
    matchedCount: results.filter((result) => result.status === "MATCHED").length,
    totalCount: results.length,
  };
}

/**
 * ADMIN cache repair: resync tank.current_stock to the latest ledger
 * balance_after. Refuses to "repair" a broken CHAIN — that means ledger
 * rows themselves are inconsistent, which no automated fix should touch.
 * Audited as TANK_UPDATED with before/after.
 */
export async function repairTankCache(adminId: string, tankId: string) {
  const tank = await db.tank.findUnique({ where: { id: tankId } });
  if (!tank) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Tank not found." });
  }

  const movements = await db.stockMovement.findMany({
    where: { tankId },
    orderBy: { id: "asc" },
    select: { id: true, quantity: true, balanceAfter: true },
  });
  const analysis = analyzeTankLedger(
    movements.map((movement) => ({
      id: movement.id,
      quantity: movement.quantity.toNumber(),
      balanceAfter: movement.balanceAfter.toNumber(),
    })),
    tank.currentStock.toNumber(),
  );

  if (!analysis.chainIntact) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Ledger chain itself is inconsistent — automated repair refused. Investigate the movement rows.",
    });
  }
  if (analysis.status === "MATCHED") {
    return { repaired: false, currentStockLiters: analysis.cachedStock };
  }

  await db.tank.update({
    where: { id: tankId },
    data: { currentStock: analysis.latestBalanceAfter },
  });
  await recordAuditEvent({
    actorId: adminId,
    action: "TANK_UPDATED",
    entityType: "tank",
    entityId: tankId,
    before: { currentStock: analysis.cachedStock },
    after: { currentStock: analysis.latestBalanceAfter, cacheRepair: true },
  });

  return { repaired: true, currentStockLiters: analysis.latestBalanceAfter };
}
