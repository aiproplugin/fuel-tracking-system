import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    delivery: { findUnique: vi.fn(), create: vi.fn() },
    tank: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { createDelivery } from "@/server/services/delivery.service";
import type { Actor } from "@/server/services/actor";

const supervisor: Actor = { id: "sup-1", role: "SUPERVISOR", siteId: "site-main" };
const admin: Actor = { id: "adm-1", role: "ADMIN", siteId: null };

function makeTank(overrides: Record<string, unknown> = {}) {
  return {
    id: "tank-1",
    name: "Multilac",
    siteId: "site-main",
    isActive: true,
    currentStock: new Prisma.Decimal("1770.00"),
    capacityLiters: new Prisma.Decimal("3000.00"),
    site: { name: "Main Depot" },
    ...overrides,
  };
}

const validInput = {
  tankId: "tank-1",
  idempotencyKey: "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55",
  liters: 500,
  deliveredAt: new Date("2026-07-03T06:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.delivery.findUnique.mockResolvedValue(null);
  mockDb.tank.findUnique.mockResolvedValue(makeTank());
  mockDb.tank.updateMany.mockResolvedValue({ count: 1 });
  mockDb.tank.findUniqueOrThrow.mockResolvedValue({
    currentStock: new Prisma.Decimal("2270.00"),
  });
  mockDb.delivery.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "del-1", ...args.data }),
  );
  mockDb.stockMovement.create.mockResolvedValue({});
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe("createDelivery", () => {
  it("writes header + one +liters DELIVERY movement with balance_after, audited", async () => {
    const result = await createDelivery(supervisor, validInput);

    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(result.delivery.balanceAfterLiters).toBe(2270);
    expect(result.delivery.replayed).toBe(false);

    const movementArg = mockDb.stockMovement.create.mock.calls[0]?.[0] as {
      data: { type: string; quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal };
    };
    expect(movementArg.data.type).toBe("DELIVERY");
    expect(movementArg.data.quantity.toNumber()).toBe(500);
    expect(movementArg.data.balanceAfter.toNumber()).toBe(2270);

    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DELIVERY_RECORDED" }),
      }),
    );
  });

  it("blocks a supervisor recording onto another site's tank", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ siteId: "site-north" }));

    await expect(createDelivery(supervisor, validInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("allows ADMIN onto any site", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ siteId: "site-north" }));
    const result = await createDelivery(admin, validInput);
    expect(result.outcome).toBe("SUCCESS");
  });

  it("blocks over-capacity at the pre-check with zero writes", async () => {
    const result = await createDelivery(supervisor, { ...validInput, liters: 2000 });

    expect(result).toMatchObject({
      outcome: "OVER_CAPACITY",
      capacityLiters: 3000,
      currentStockLiters: 1770,
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns OVER_CAPACITY when the in-transaction guard loses a race", async () => {
    mockDb.tank.updateMany.mockResolvedValue({ count: 0 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("2900.00"),
      capacityLiters: new Prisma.Decimal("3000.00"),
    });

    const result = await createDelivery(supervisor, validInput);

    expect(result.outcome).toBe("OVER_CAPACITY");
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });

  it("replays an existing idempotency key without touching the ledger", async () => {
    mockDb.delivery.findUnique.mockResolvedValue({
      id: "del-original",
      receivedById: "sup-1",
      liters: new Prisma.Decimal("500.00"),
      deliveredAt: new Date("2026-07-03T06:00:00Z"),
      tank: { name: "Multilac" },
      movement: { balanceAfter: new Prisma.Decimal("2270.00") },
    });

    const result = await createDelivery(supervisor, validInput);

    expect(result).toMatchObject({
      outcome: "SUCCESS",
      delivery: { id: "del-original", replayed: true, balanceAfterLiters: 2270 },
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("treats a key owned by someone else as a hard conflict", async () => {
    mockDb.delivery.findUnique.mockResolvedValue({
      id: "del-foreign",
      receivedById: "someone-else",
      liters: new Prisma.Decimal("1.00"),
      deliveredAt: new Date(),
      tank: { name: "X" },
      movement: null,
    });

    await expect(createDelivery(supervisor, validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
