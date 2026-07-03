import { describe, expect, it } from "vitest";
import { analyzeTankLedger, type LedgerMovement } from "@/server/services/reconciliation-core";

function movement(id: number, quantity: number, balanceAfter: number): LedgerMovement {
  return { id: BigInt(id), quantity, balanceAfter };
}

describe("analyzeTankLedger", () => {
  it("matches a clean ledger with an aligned cache", () => {
    const result = analyzeTankLedger(
      [movement(1, 2480, 2480), movement(2, -42, 2438), movement(3, 400, 2838)],
      2838,
    );
    expect(result.status).toBe("MATCHED");
    expect(result.chainIntact).toBe(true);
    expect(result.replayedBalance).toBe(2838);
  });

  it("matches an empty ledger with a zero cache (new tank)", () => {
    const result = analyzeTankLedger([], 0);
    expect(result.status).toBe("MATCHED");
    expect(result.latestBalanceAfter).toBe(0);
  });

  it("flags a drifted cache (ledger intact, cache wrong)", () => {
    const result = analyzeTankLedger(
      [movement(1, 1000, 1000), movement(2, -100, 900)],
      950, // cache tampered/drifted
    );
    expect(result.status).toBe("MISMATCH");
    expect(result.chainIntact).toBe(true);
    expect(result.latestBalanceAfter).toBe(900);
    expect(result.cachedStock).toBe(950);
  });

  it("flags a broken chain and names the first broken movement", () => {
    const result = analyzeTankLedger(
      [
        movement(1, 1000, 1000),
        movement(2, -100, 850), // should be 900
        movement(3, 50, 900),
      ],
      900,
    );
    expect(result.status).toBe("MISMATCH");
    expect(result.chainIntact).toBe(false);
    expect(result.brokenAtMovementId).toBe(BigInt(2));
  });

  it("tolerates Decimal(12,2) rounding within epsilon", () => {
    const result = analyzeTankLedger(
      [movement(1, 33.33, 33.33), movement(2, 33.33, 66.66), movement(3, 33.34, 100)],
      100,
    );
    expect(result.status).toBe("MATCHED");
  });
});
