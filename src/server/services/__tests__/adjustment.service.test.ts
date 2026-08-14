import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    stockAdjustment: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    tank: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { ADJUSTMENT_REASONS } from "@/lib/adjustment-reason";
import { createAdjustment, listAdjustments } from "@/server/services/adjustment.service";
import type { Actor } from "@/server/services/actor";
import { testActor } from "@/server/services/__tests__/test-actor";

const supervisor: Actor = testActor("SUPERVISOR", { id: "sup-1", siteId: "site-main" });

function makeTank(overrides: Record<string, unknown> = {}) {
  return {
    id: "tank-1",
    name: "Multilac",
    siteId: "site-main",
    isActive: true,
    currentStock: new Prisma.Decimal("1770.00"),
    capacityLiters: new Prisma.Decimal("3000.00"),
    ...overrides,
  };
}

const validInput = {
  tankId: "tank-1",
  idempotencyKey: "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55",
  quantityChange: -25,
  reasonCategory: "LEAK_OR_SPILL" as const,
  reason: "Physical dip reading below ledger.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.stockAdjustment.findUnique.mockResolvedValue(null);
  mockDb.tank.findUnique.mockResolvedValue(makeTank());
  mockDb.tank.updateMany.mockResolvedValue({ count: 1 });
  mockDb.tank.findUniqueOrThrow.mockResolvedValue({
    currentStock: new Prisma.Decimal("1745.00"),
  });
  mockDb.stockAdjustment.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "adj-1", ...args.data }),
  );
  mockDb.stockMovement.create.mockResolvedValue({});
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe("createAdjustment", () => {
  it("records a negative adjustment with a signed movement, audited with reason", async () => {
    const result = await createAdjustment(supervisor, validInput);

    expect(result.outcome).toBe("SUCCESS");
    const movementArg = mockDb.stockMovement.create.mock.calls[0]?.[0] as {
      data: { type: string; quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal };
    };
    expect(movementArg.data.type).toBe("ADJUSTMENT");
    expect(movementArg.data.quantity.toNumber()).toBe(-25);
    expect(movementArg.data.balanceAfter.toNumber()).toBe(1745);

    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; after: { reason: string; reasonCategory: string } };
    };
    expect(auditArg.data.action).toBe("ADJUSTMENT_RECORDED");
    expect(auditArg.data.after.reason).toContain("Physical dip");
    // The category must reach the trail too, so the audit itself is analysable.
    expect(auditArg.data.after.reasonCategory).toBe("LEAK_OR_SPILL");
  });

  it("persists the reason category alongside the free-text detail", async () => {
    await createAdjustment(supervisor, {
      ...validInput,
      reasonCategory: "UNAUTHORIZED_EXTRACTION",
    });

    const adjustmentArg = mockDb.stockAdjustment.create.mock.calls[0]?.[0] as {
      data: { reasonCategory: string; reason: string; quantityChange: Prisma.Decimal };
    };
    expect(adjustmentArg.data.reasonCategory).toBe("UNAUTHORIZED_EXTRACTION");
    expect(adjustmentArg.data.reason).toBe("Physical dip reading below ledger.");
    // The category is metadata only — the ledger maths is unchanged by it.
    expect(adjustmentArg.data.quantityChange.toNumber()).toBe(-25);

    const movementArg = mockDb.stockMovement.create.mock.calls[0]?.[0] as {
      data: { quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal };
    };
    expect(movementArg.data.quantity.toNumber()).toBe(-25);
    expect(movementArg.data.balanceAfter.toNumber()).toBe(1745);
  });

  it("records the same ledger movement whichever category is chosen", async () => {
    for (const [index, category] of ADJUSTMENT_REASONS.entries()) {
      const result = await createAdjustment(supervisor, {
        ...validInput,
        idempotencyKey: `9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a5${index}`,
        reasonCategory: category,
      });

      expect(result).toMatchObject({ outcome: "SUCCESS" });
      const movementArg = mockDb.stockMovement.create.mock.calls[index]?.[0] as {
        data: { type: string; quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal };
      };
      expect(movementArg.data.type).toBe("ADJUSTMENT");
      expect(movementArg.data.quantity.toNumber()).toBe(-25);
      expect(movementArg.data.balanceAfter.toNumber()).toBe(1745);
    }
  });

  it("blocks removing more than recorded stock (pre-check, zero writes)", async () => {
    const result = await createAdjustment(supervisor, {
      ...validInput,
      quantityChange: -2000,
    });

    expect(result).toMatchObject({ outcome: "INSUFFICIENT_STOCK", currentStockLiters: 1770 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a positive adjustment beyond capacity", async () => {
    const result = await createAdjustment(supervisor, {
      ...validInput,
      quantityChange: 2000,
    });

    expect(result).toMatchObject({ outcome: "OVER_CAPACITY", capacityLiters: 3000 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a supervisor adjusting another site's tank", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ siteId: "site-north" }));

    await expect(createAdjustment(supervisor, validInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("replays an existing idempotency key without a second movement", async () => {
    mockDb.stockAdjustment.findUnique.mockResolvedValue({
      id: "adj-original",
      adjustedById: "sup-1",
      quantityChange: new Prisma.Decimal("-25.00"),
      tank: { name: "Multilac" },
      movement: { balanceAfter: new Prisma.Decimal("1745.00") },
    });

    const result = await createAdjustment(supervisor, validInput);

    expect(result).toMatchObject({
      outcome: "SUCCESS",
      adjustment: { id: "adj-original", replayed: true },
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("surfaces both the category and the detail in the register listing", async () => {
    mockDb.stockAdjustment.findMany.mockResolvedValue([
      {
        id: "adj-1",
        quantityChange: new Prisma.Decimal("-25.00"),
        reasonCategory: "EVAPORATION_OR_SLUDGE",
        reason: "Tank-bottom sediment removed at the July clean-out.",
        adjustedAt: new Date("2026-07-02T04:30:00.000Z"),
        tank: { name: "Multilac" },
        adjustedBy: { displayName: "Sunil P." },
        movement: { balanceAfter: new Prisma.Decimal("1745.00") },
      },
    ]);

    const result = await listAdjustments(supervisor, { limit: 20 });

    expect(result.adjustments[0]).toMatchObject({
      reasonCategory: "EVAPORATION_OR_SLUDGE",
      reason: "Tank-bottom sediment removed at the July clean-out.",
      quantityChange: -25,
    });
  });

  it("uses the in-transaction guard as the real gate on races", async () => {
    mockDb.tank.updateMany.mockResolvedValue({ count: 0 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("10.00"),
      capacityLiters: new Prisma.Decimal("3000.00"),
    });

    const result = await createAdjustment(supervisor, validInput);

    expect(result.outcome).toBe("INSUFFICIENT_STOCK");
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });
});
