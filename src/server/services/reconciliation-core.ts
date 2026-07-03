/**
 * Reconciliation core — pure ledger math, no I/O, no path aliases (so the
 * CLI in scripts/reconcile.ts can import it relatively under tsx).
 *
 * The ledger is ALWAYS the source of truth; tank.current_stock is a cache.
 * A tank is healthy when:
 *  1. every movement's balance_after equals the previous balance_after plus
 *     its signed quantity (intact chain, starting from zero), and
 *  2. the cached stock equals the last movement's balance_after
 *     (or zero for a tank with no movements yet).
 */

export interface LedgerMovement {
  id: bigint;
  quantity: number;
  balanceAfter: number;
}

export interface TankLedgerAnalysis {
  status: "MATCHED" | "MISMATCH";
  chainIntact: boolean;
  /** First movement id where the chain breaks, if any. */
  brokenAtMovementId: bigint | null;
  cachedStock: number;
  latestBalanceAfter: number;
  /** Balance obtained by replaying quantities from zero. */
  replayedBalance: number;
  movementCount: number;
}

const EPSILON = 0.005; // Decimal(12,2) values compared as numbers

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON;
}

/** Analyze one tank's ordered movement list against its cached stock. */
export function analyzeTankLedger(
  movements: readonly LedgerMovement[],
  cachedStock: number,
): TankLedgerAnalysis {
  let running = 0;
  let chainIntact = true;
  let brokenAtMovementId: bigint | null = null;

  for (const movement of movements) {
    running += movement.quantity;
    if (chainIntact && differs(movement.balanceAfter, running)) {
      chainIntact = false;
      brokenAtMovementId = movement.id;
    }
  }

  const latestBalanceAfter =
    movements.length > 0 ? (movements[movements.length - 1]?.balanceAfter ?? 0) : 0;
  const cacheMatches = !differs(cachedStock, latestBalanceAfter);

  return {
    status: chainIntact && cacheMatches ? "MATCHED" : "MISMATCH",
    chainIntact,
    brokenAtMovementId,
    cachedStock,
    latestBalanceAfter,
    replayedBalance: Math.round(running * 100) / 100,
    movementCount: movements.length,
  };
}
