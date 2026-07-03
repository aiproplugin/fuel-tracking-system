import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    fuelTransaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    tank: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    vehicle: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    qrToken: { findUnique: vi.fn() },
    odometerException: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import {
  flagOdometerException,
  reviewOdometerException,
  submitFuelIssue,
  type OperatorActor,
} from "@/server/services/fuel-issue.service";

const operator: OperatorActor = {
  id: "op-1",
  role: "OPERATOR",
  siteId: "site-1",
  defaultTankId: "tank-1",
};

function makeTank(overrides: Record<string, unknown> = {}) {
  return {
    id: "tank-1",
    name: "Tank A",
    fuelType: "DIESEL",
    isActive: true,
    currentStock: new Prisma.Decimal("2480.00"),
    lowStockThreshold: new Prisma.Decimal("1000.00"),
    ...overrides,
  };
}

function makeVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "veh-1",
    plateNumber: "CAB-4587",
    fuelType: "DIESEL",
    isActive: true,
    currentOdometer: 124_880,
    vehicleType: {
      minKmPerLiter: new Prisma.Decimal("2.00"),
      maxKmPerLiter: new Prisma.Decimal("6.00"),
    },
    ...overrides,
  };
}

const validInput = {
  vehicleId: "veh-1",
  idempotencyKey: "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55",
  liters: 42,
  odometer: 125_120,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.fuelTransaction.findUnique.mockResolvedValue(null); // no replay by default
  mockDb.fuelTransaction.findFirst.mockResolvedValue(null); // first fill by default
  mockDb.tank.findUnique.mockResolvedValue(makeTank());
  mockDb.vehicle.findUnique.mockResolvedValue(makeVehicle());
  mockDb.vehicle.update.mockResolvedValue({});
  mockDb.stockMovement.create.mockResolvedValue({});
  mockDb.tank.updateMany.mockResolvedValue({ count: 1 });
  mockDb.tank.findUniqueOrThrow.mockResolvedValue({
    currentStock: new Prisma.Decimal("2438.00"),
  });
  mockDb.fuelTransaction.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "tx-1", odometerOverride: false, ...args.data }),
  );
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe("submitFuelIssue — hard blocks (no writes)", () => {
  it("blocks a fuel-type mismatch before any transaction", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeVehicle({ fuelType: "PETROL" }));

    const result = await submitFuelIssue(operator, validInput);

    expect(result).toEqual({
      outcome: "FUEL_TYPE_MISMATCH",
      vehicleFuelType: "PETROL",
      tankFuelType: "DIESEL",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks an odometer regression before any transaction", async () => {
    const result = await submitFuelIssue(operator, { ...validInput, odometer: 124_100 });

    expect(result).toEqual({
      outcome: "ODOMETER_BLOCKED",
      previousOdometer: 124_880,
      attemptedOdometer: 124_100,
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks insufficient stock at the pre-check", async () => {
    const result = await submitFuelIssue(operator, { ...validInput, liters: 5000 });

    expect(result).toMatchObject({ outcome: "INSUFFICIENT_STOCK", availableLiters: 2480 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns INSUFFICIENT_STOCK when the in-transaction guard loses a race", async () => {
    mockDb.tank.updateMany.mockResolvedValue({ count: 0 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("10.00"),
    });

    const result = await submitFuelIssue(operator, validInput);

    expect(result).toMatchObject({ outcome: "INSUFFICIENT_STOCK", availableLiters: 10 });
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe("submitFuelIssue — success path", () => {
  it("writes transaction + one signed movement with balance_after + caches, atomically", async () => {
    const result = await submitFuelIssue(operator, validInput);

    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(result.replayed).toBe(false);
    expect(result.receipt.balanceAfterLiters).toBe(2438);
    expect(result.receipt.kmPerLiter).toBeNull(); // first fill

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    const movementArg = mockDb.stockMovement.create.mock.calls[0]?.[0] as {
      data: {
        type: string;
        quantity: Prisma.Decimal;
        balanceAfter: Prisma.Decimal;
        fuelTransactionId: string;
      };
    };
    expect(movementArg.data.type).toBe("ISSUE");
    expect(movementArg.data.quantity.toNumber()).toBe(-42);
    expect(movementArg.data.balanceAfter.toNumber()).toBe(2438);
    expect(movementArg.data.fuelTransactionId).toBe("tx-1");

    expect(mockDb.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentOdometer: 125_120 } }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "FUEL_ISSUED" }) }),
    );
  });

  it("computes efficiency from the previous fill and flags abnormal outside the band", async () => {
    // Previous fill: 10 L at 124,880 km. Now 125,120 -> 240 km / 10 L = 24 km/L > 6.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      odometer: 124_880,
      liters: new Prisma.Decimal("10.00"),
    });

    const result = await submitFuelIssue(operator, { ...validInput, liters: 30 });

    expect(result.outcome).toBe("SUCCESS");
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { kmPerLiter: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.kmPerLiter?.toNumber()).toBe(24);
    expect(createArg.data.isAbnormal).toBe(true);
  });

  it("stays normal inside the band", async () => {
    // 240 km / 42 L = 5.71 km/L, inside 2..6.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      odometer: 124_880,
      liters: new Prisma.Decimal("42.00"),
    });

    await submitFuelIssue(operator, validInput);

    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { kmPerLiter: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.kmPerLiter?.toNumber()).toBe(5.71);
    expect(createArg.data.isAbnormal).toBe(false);
  });
});

describe("submitFuelIssue — idempotency", () => {
  it("replays the original receipt without touching the ledger", async () => {
    mockDb.fuelTransaction.findUnique.mockResolvedValue({
      id: "tx-original",
      operatorId: "op-1",
      liters: new Prisma.Decimal("42.00"),
      odometer: 125_120,
      kmPerLiter: null,
      isAbnormal: false,
      odometerOverride: false,
      issuedAt: new Date("2026-07-03T04:00:00Z"),
      vehicle: { plateNumber: "CAB-4587" },
      tank: { name: "Tank A" },
      movement: { balanceAfter: new Prisma.Decimal("2438.00") },
    });

    const result = await submitFuelIssue(operator, validInput);

    expect(result).toMatchObject({
      outcome: "SUCCESS",
      replayed: true,
      receipt: { transactionId: "tx-original", balanceAfterLiters: 2438 },
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("treats a key owned by another operator as a hard conflict", async () => {
    mockDb.fuelTransaction.findUnique.mockResolvedValue({
      id: "tx-foreign",
      operatorId: "someone-else",
      vehicle: { plateNumber: "X" },
      tank: { name: "Y" },
      movement: null,
    });

    await expect(submitFuelIssue(operator, validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("flagOdometerException", () => {
  it("creates a PENDING exception with liters and audits it", async () => {
    mockDb.odometerException.create.mockResolvedValue({ id: "exc-1" });

    const result = await flagOdometerException(operator, {
      vehicleId: "veh-1",
      attemptedOdometer: 124_100,
      liters: 25,
    });

    expect(result).toEqual({ exceptionId: "exc-1" });
    const createArg = mockDb.odometerException.create.mock.calls[0]?.[0] as {
      data: { liters: Prisma.Decimal; previousOdometer: number; attemptedOdometer: number };
    };
    expect(createArg.data.liters.toNumber()).toBe(25);
    expect(createArg.data.previousOdometer).toBe(124_880);
    expect(createArg.data.attemptedOdometer).toBe(124_100);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ODOMETER_EXCEPTION_FLAGGED" }),
      }),
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled(); // no ledger write on flag
  });
});

describe("reviewOdometerException", () => {
  function makePendingException(overrides: Record<string, unknown> = {}) {
    return {
      id: "exc-1",
      status: "PENDING",
      vehicleId: "veh-1",
      tankId: "tank-1",
      operatorId: "op-1",
      liters: new Prisma.Decimal("25.00"),
      previousOdometer: 124_880,
      attemptedOdometer: 124_100,
      createdAt: new Date("2026-07-03T04:00:00Z"),
      vehicle: makeVehicle(),
      tank: makeTank(),
      ...overrides,
    };
  }

  it("APPROVE creates the override transaction + movement atomically", async () => {
    mockDb.odometerException.findUnique.mockResolvedValue(makePendingException());
    mockDb.odometerException.updateMany.mockResolvedValue({ count: 1 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("2455.00"),
    });

    const result = await reviewOdometerException("admin-1", {
      exceptionId: "exc-1",
      decision: "APPROVE",
      correctedOdometer: 125_140,
      reason: "Operator entered the previous reading in error.",
    });

    expect(result).toMatchObject({ decision: "APPROVE", transactionId: "tx-1" });
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: {
        odometerOverride: boolean;
        overrideByUserId: string;
        operatorId: string;
        odometer: number;
      };
    };
    expect(createArg.data.odometerOverride).toBe(true);
    expect(createArg.data.overrideByUserId).toBe("admin-1");
    expect(createArg.data.operatorId).toBe("op-1"); // credited to the operator
    expect(createArg.data.odometer).toBe(125_140);

    expect(mockDb.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(mockDb.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentOdometer: 125_140 } }),
    );

    const auditActions = mockDb.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain("ODOMETER_OVERRIDE");
    expect(auditActions).toContain("ODOMETER_EXCEPTION_REVIEWED");
  });

  it("APPROVE rejects a corrected odometer below the vehicle's current reading", async () => {
    mockDb.odometerException.findUnique.mockResolvedValue(makePendingException());

    await expect(
      reviewOdometerException("admin-1", {
        exceptionId: "exc-1",
        decision: "APPROVE",
        correctedOdometer: 124_000,
        reason: "Attempting an invalid correction.",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("REJECT records the decision without any ledger write", async () => {
    mockDb.odometerException.findUnique.mockResolvedValue(makePendingException());
    mockDb.odometerException.updateMany.mockResolvedValue({ count: 1 });

    const result = await reviewOdometerException("admin-1", {
      exceptionId: "exc-1",
      decision: "REJECT",
      reason: "Reading could not be verified.",
    });

    expect(result).toEqual({ decision: "REJECT" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });

  it("refuses to review an already-reviewed exception", async () => {
    mockDb.odometerException.findUnique.mockResolvedValue(
      makePendingException({ status: "APPROVED" }),
    );

    await expect(
      reviewOdometerException("admin-1", {
        exceptionId: "exc-1",
        decision: "REJECT",
        reason: "Double review attempt.",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
