/**
 * Ledger reconciliation CLI — `npm run reconcile` (add `-- --repair` to
 * resync drifted caches to the ledger; chain breaks are never auto-fixed).
 *
 * Exit codes: 0 = all tanks matched, 1 = at least one mismatch (repairable
 * or not). Suitable for a Windows scheduled task; output is one line per
 * tank. Uses relative imports (tsx does not resolve the @ path alias).
 */
import { PrismaClient } from "@prisma/client";
import { analyzeTankLedger } from "../src/server/services/reconciliation-core";

const prisma = new PrismaClient();
const repairMode = process.argv.includes("--repair");

async function main(): Promise<number> {
  const tanks = await prisma.tank.findMany({
    orderBy: { name: "asc" },
    include: { site: { select: { name: true } } },
  });

  let mismatches = 0;

  for (const tank of tanks) {
    const movements = await prisma.stockMovement.findMany({
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

    const label = `${tank.name} (${tank.site.name})`;
    if (analysis.status === "MATCHED") {
      console.log(
        `MATCHED   ${label}: stock ${analysis.cachedStock} L over ${analysis.movementCount} movements`,
      );
      continue;
    }

    mismatches += 1;
    if (!analysis.chainIntact) {
      console.error(
        `BROKEN    ${label}: ledger chain inconsistent at movement #${analysis.brokenAtMovementId} — NOT auto-repairable, investigate`,
      );
      continue;
    }

    console.error(
      `MISMATCH  ${label}: cache ${analysis.cachedStock} L != ledger ${analysis.latestBalanceAfter} L`,
    );
    if (repairMode) {
      await prisma.tank.update({
        where: { id: tank.id },
        data: { currentStock: analysis.latestBalanceAfter },
      });
      await prisma.auditLog.create({
        data: {
          actorId: null, // CLI repair; run under an operator of record if needed
          action: "TANK_UPDATED",
          entityType: "tank",
          entityId: tank.id,
          before: { currentStock: analysis.cachedStock },
          after: { currentStock: analysis.latestBalanceAfter, cacheRepair: true, via: "cli" },
        },
      });
      console.error(`REPAIRED  ${label}: cache resynced to ${analysis.latestBalanceAfter} L`);
    }
  }

  console.log(
    `\n${tanks.length - mismatches}/${tanks.length} tanks matched${repairMode ? " (repair mode)" : ""}`,
  );
  return mismatches === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
