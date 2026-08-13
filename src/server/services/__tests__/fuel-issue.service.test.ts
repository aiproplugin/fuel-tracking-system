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
    meterException: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    // No quota_settings row = master switch OFF: these tests exercise the
    // pre-quota behaviour, which must be unchanged while the switch is off.
    quotaSettings: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import {
  flagMeterException,
  reviewMeterException,
  submitFuelIssue,
  type OperatorActor,
} from "@/server/services/fuel-issue.service";
import { testActor } from "@/server/services/__tests__/test-actor";

const operator: OperatorActor = testActor("OPERATOR", {
  id: "op-1",
  siteId: "site-1",
  defaultTankId: "tank-1",
});

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
    currentMeter: 124_880,
    vehicleType: {
      meterType: "DISTANCE",
      minEfficiency: new Prisma.Decimal("2.00"),
      maxEfficiency: new Prisma.Decimal("6.00"),
    },
    ...overrides,
  };
}

/** A DIESEL forklift (HOURS meter, band 0.8–2.5 hrs/L). */
function makeForklift(overrides: Record<string, unknown> = {}) {
  return makeVehicle({
    id: "veh-fl",
    plateNumber: "FL-2201",
    currentMeter: 3_420,
    vehicleType: {
      meterType: "HOURS",
      minEfficiency: new Prisma.Decimal("0.80"),
      maxEfficiency: new Prisma.Decimal("2.50"),
    },
    ...overrides,
  });
}

/** A KEROSENE burner (HOURS meter, band 0.5–1.6 hrs/L) drawing from Tank D. */
function makeKeroseneBurner(overrides: Record<string, unknown> = {}) {
  return makeVehicle({
    id: "veh-kb",
    plateNumber: "KB-0450",
    fuelType: "KEROSENE",
    currentMeter: 1_180,
    vehicleType: {
      meterType: "HOURS",
      minEfficiency: new Prisma.Decimal("0.50"),
      maxEfficiency: new Prisma.Decimal("1.60"),
    },
    ...overrides,
  });
}

/** A DIESEL generator (ENERGY meter, band 2.5–4.0 kWh/L). */
function makeGenerator(overrides: Record<string, unknown> = {}) {
  return makeVehicle({
    id: "veh-gen",
    plateNumber: "GEN-01",
    currentMeter: 128_400,
    vehicleType: {
      meterType: "ENERGY",
      minEfficiency: new Prisma.Decimal("2.50"),
      maxEfficiency: new Prisma.Decimal("4.00"),
    },
    ...overrides,
  });
}

const validInput = {
  vehicleId: "veh-1",
  idempotencyKey: "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55",
  liters: 42,
  meterReading: 125_120,
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
    Promise.resolve({ id: "tx-1", meterOverride: false, ...args.data }),
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

  // KEROSENE is a first-class fuel type: the block is a plain inequality on the
  // enum, so it must fire in BOTH directions against a kerosene tank/vehicle.
  it("blocks a KEROSENE vehicle at a DIESEL tank", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeKeroseneBurner());

    const result = await submitFuelIssue(operator, { ...validInput, vehicleId: "veh-kb" });

    expect(result).toEqual({
      outcome: "FUEL_TYPE_MISMATCH",
      vehicleFuelType: "KEROSENE",
      tankFuelType: "DIESEL",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a DIESEL vehicle at a KEROSENE tank", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ name: "Tank D", fuelType: "KEROSENE" }));

    const result = await submitFuelIssue(operator, validInput);

    expect(result).toEqual({
      outcome: "FUEL_TYPE_MISMATCH",
      vehicleFuelType: "DIESEL",
      tankFuelType: "KEROSENE",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a PETROL vehicle at a KEROSENE tank", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ name: "Tank D", fuelType: "KEROSENE" }));
    mockDb.vehicle.findUnique.mockResolvedValue(makeVehicle({ fuelType: "PETROL" }));

    const result = await submitFuelIssue(operator, validInput);

    expect(result).toEqual({
      outcome: "FUEL_TYPE_MISMATCH",
      vehicleFuelType: "PETROL",
      tankFuelType: "KEROSENE",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a meter regression before any transaction (DISTANCE)", async () => {
    const result = await submitFuelIssue(operator, { ...validInput, meterReading: 124_100 });

    expect(result).toEqual({
      outcome: "METER_BLOCKED",
      meterType: "DISTANCE",
      previousReading: 124_880,
      attemptedReading: 124_100,
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a meter regression identically for an HOURS vehicle", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeForklift());

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-fl",
      meterReading: 3_400,
    });

    expect(result).toEqual({
      outcome: "METER_BLOCKED",
      meterType: "HOURS",
      previousReading: 3_420,
      attemptedReading: 3_400,
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a meter regression identically for an ENERGY vehicle", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeGenerator());

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-gen",
      meterReading: 128_000,
    });

    expect(result).toEqual({
      outcome: "METER_BLOCKED",
      meterType: "ENERGY",
      previousReading: 128_400,
      attemptedReading: 128_000,
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
    expect(result.receipt.efficiency).toBeNull(); // first fill
    expect(result.receipt.meterType).toBe("DISTANCE");

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
      expect.objectContaining({ data: { currentMeter: 125_120 } }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "FUEL_ISSUED" }) }),
    );
  });

  it("issues normally when a KEROSENE vehicle draws from a KEROSENE tank", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ name: "Tank D", fuelType: "KEROSENE" }));
    mockDb.vehicle.findUnique.mockResolvedValue(makeKeroseneBurner());
    // Previous fill: 20 L at 1,180 hrs. Now 1,200 -> 20 hrs / 20 L = 1.00 hrs/L (in band).
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 1_180,
      liters: new Prisma.Decimal("20.00"),
    });

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-kb",
      liters: 20,
      meterReading: 1_200,
    });

    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(result.receipt.meterType).toBe("HOURS");
    expect(result.receipt.efficiency).toBe(1);

    // The ledger write is identical to any other fuel type: one signed movement.
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    const movementArg = mockDb.stockMovement.create.mock.calls[0]?.[0] as {
      data: { type: string; quantity: Prisma.Decimal; balanceAfter: Prisma.Decimal };
    };
    expect(movementArg.data.type).toBe("ISSUE");
    expect(movementArg.data.quantity.toNumber()).toBe(-20);
    expect(movementArg.data.balanceAfter.toNumber()).toBe(2438);

    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(1);
    expect(createArg.data.isAbnormal).toBe(false);
  });

  it("flags a KEROSENE fill outside its vehicle type's band", async () => {
    mockDb.tank.findUnique.mockResolvedValue(makeTank({ name: "Tank D", fuelType: "KEROSENE" }));
    mockDb.vehicle.findUnique.mockResolvedValue(makeKeroseneBurner());
    // 20 hrs / 10 L = 2.00 hrs/L, above the 1.60 ceiling.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 1_180,
      liters: new Prisma.Decimal("10.00"),
    });

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-kb",
      liters: 20,
      meterReading: 1_200,
    });

    expect(result.outcome).toBe("SUCCESS");
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(2);
    expect(createArg.data.isAbnormal).toBe(true);
  });

  it("computes efficiency from the previous fill and flags abnormal outside the band", async () => {
    // Previous fill: 10 L at 124,880 km. Now 125,120 -> 240 km / 10 L = 24 km/L > 6.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 124_880,
      liters: new Prisma.Decimal("10.00"),
    });

    const result = await submitFuelIssue(operator, { ...validInput, liters: 30 });

    expect(result.outcome).toBe("SUCCESS");
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(24);
    expect(createArg.data.isAbnormal).toBe(true);
  });

  it("stays normal inside the band", async () => {
    // 240 km / 42 L = 5.71 km/L, inside 2..6.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 124_880,
      liters: new Prisma.Decimal("42.00"),
    });

    await submitFuelIssue(operator, validInput);

    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(5.71);
    expect(createArg.data.isAbnormal).toBe(false);
  });

  it("computes hrs/L for an HOURS vehicle with the same code path and band logic", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeForklift());
    // Previous fill: 10 L at 3,420 hrs. Now 3,432 -> 12 hrs / 10 L = 1.20 hrs/L (in band).
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 3_420,
      liters: new Prisma.Decimal("10.00"),
    });

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-fl",
      meterReading: 3_432,
    });

    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(result.receipt.meterType).toBe("HOURS");
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(1.2);
    expect(createArg.data.isAbnormal).toBe(false);
  });

  it("computes kWh/L for an ENERGY vehicle and flags outside the band", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeGenerator());
    // Previous fill: 100 L at 128,400 kWh. Now 128,600 -> 200 kWh / 100 L = 2.00 kWh/L < 2.5.
    mockDb.fuelTransaction.findFirst.mockResolvedValue({
      meterReading: 128_400,
      liters: new Prisma.Decimal("100.00"),
    });

    const result = await submitFuelIssue(operator, {
      ...validInput,
      vehicleId: "veh-gen",
      meterReading: 128_600,
    });

    expect(result.outcome).toBe("SUCCESS");
    if (result.outcome !== "SUCCESS") return;
    expect(result.receipt.meterType).toBe("ENERGY");
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: { efficiency: Prisma.Decimal | null; isAbnormal: boolean };
    };
    expect(createArg.data.efficiency?.toNumber()).toBe(2);
    expect(createArg.data.isAbnormal).toBe(true);
  });
});

describe("submitFuelIssue — idempotency", () => {
  it("replays the original receipt without touching the ledger", async () => {
    mockDb.fuelTransaction.findUnique.mockResolvedValue({
      id: "tx-original",
      operatorId: "op-1",
      liters: new Prisma.Decimal("42.00"),
      meterReading: 125_120,
      efficiency: null,
      isAbnormal: false,
      meterOverride: false,
      issuedAt: new Date("2026-07-03T04:00:00Z"),
      vehicle: { plateNumber: "CAB-4587", vehicleType: { meterType: "DISTANCE" } },
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
      vehicle: { plateNumber: "X", vehicleType: { meterType: "DISTANCE" } },
      tank: { name: "Y" },
      movement: null,
    });

    await expect(submitFuelIssue(operator, validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("flagMeterException", () => {
  it("creates a PENDING exception with liters and audits it", async () => {
    mockDb.meterException.create.mockResolvedValue({ id: "exc-1" });

    const result = await flagMeterException(operator, {
      vehicleId: "veh-1",
      attemptedReading: 124_100,
      liters: 25,
    });

    expect(result).toEqual({ exceptionId: "exc-1" });
    const createArg = mockDb.meterException.create.mock.calls[0]?.[0] as {
      data: { liters: Prisma.Decimal; previousReading: number; attemptedReading: number };
    };
    expect(createArg.data.liters.toNumber()).toBe(25);
    expect(createArg.data.previousReading).toBe(124_880);
    expect(createArg.data.attemptedReading).toBe(124_100);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "METER_EXCEPTION_FLAGGED" }),
      }),
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled(); // no ledger write on flag
  });

  it("works identically for a non-DISTANCE vehicle", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(makeForklift());
    mockDb.meterException.create.mockResolvedValue({ id: "exc-fl" });

    const result = await flagMeterException(operator, {
      vehicleId: "veh-fl",
      attemptedReading: 3_400,
      liters: 12,
    });

    expect(result).toEqual({ exceptionId: "exc-fl" });
    const createArg = mockDb.meterException.create.mock.calls[0]?.[0] as {
      data: { previousReading: number; attemptedReading: number };
    };
    expect(createArg.data.previousReading).toBe(3_420);
    expect(createArg.data.attemptedReading).toBe(3_400);
  });
});

describe("reviewMeterException", () => {
  function makePendingException(overrides: Record<string, unknown> = {}) {
    return {
      id: "exc-1",
      status: "PENDING",
      vehicleId: "veh-1",
      tankId: "tank-1",
      operatorId: "op-1",
      liters: new Prisma.Decimal("25.00"),
      previousReading: 124_880,
      attemptedReading: 124_100,
      createdAt: new Date("2026-07-03T04:00:00Z"),
      vehicle: makeVehicle(),
      tank: makeTank(),
      ...overrides,
    };
  }

  it("APPROVE creates the override transaction + movement atomically", async () => {
    mockDb.meterException.findUnique.mockResolvedValue(makePendingException());
    mockDb.meterException.updateMany.mockResolvedValue({ count: 1 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("2455.00"),
    });

    const result = await reviewMeterException("admin-1", {
      exceptionId: "exc-1",
      decision: "APPROVE",
      correctedReading: 125_140,
      reason: "Operator entered the previous reading in error.",
    });

    expect(result).toMatchObject({ decision: "APPROVE", transactionId: "tx-1" });
    const createArg = mockDb.fuelTransaction.create.mock.calls[0]?.[0] as {
      data: {
        meterOverride: boolean;
        overrideByUserId: string;
        operatorId: string;
        meterReading: number;
      };
    };
    expect(createArg.data.meterOverride).toBe(true);
    expect(createArg.data.overrideByUserId).toBe("admin-1");
    expect(createArg.data.operatorId).toBe("op-1"); // credited to the operator
    expect(createArg.data.meterReading).toBe(125_140);

    expect(mockDb.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(mockDb.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentMeter: 125_140 } }),
    );

    const auditActions = mockDb.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain("METER_OVERRIDE");
    expect(auditActions).toContain("METER_EXCEPTION_REVIEWED");
  });

  it("APPROVE rejects a corrected reading below the vehicle's current reading", async () => {
    mockDb.meterException.findUnique.mockResolvedValue(makePendingException());

    await expect(
      reviewMeterException("admin-1", {
        exceptionId: "exc-1",
        decision: "APPROVE",
        correctedReading: 124_000,
        reason: "Attempting an invalid correction.",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("APPROVE works identically for an HOURS vehicle", async () => {
    mockDb.meterException.findUnique.mockResolvedValue(
      makePendingException({
        id: "exc-fl",
        vehicleId: "veh-fl",
        previousReading: 3_420,
        attemptedReading: 3_400,
        vehicle: makeForklift(),
      }),
    );
    mockDb.meterException.updateMany.mockResolvedValue({ count: 1 });
    mockDb.tank.findUniqueOrThrow.mockResolvedValue({
      currentStock: new Prisma.Decimal("2455.00"),
    });

    const result = await reviewMeterException("admin-1", {
      exceptionId: "exc-fl",
      decision: "APPROVE",
      correctedReading: 3_430,
      reason: "Hour meter photo verified by supervisor.",
    });

    expect(result).toMatchObject({ decision: "APPROVE", transactionId: "tx-1" });
    expect(mockDb.vehicle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentMeter: 3_430 } }),
    );
  });

  it("REJECT records the decision without any ledger write", async () => {
    mockDb.meterException.findUnique.mockResolvedValue(makePendingException());
    mockDb.meterException.updateMany.mockResolvedValue({ count: 1 });

    const result = await reviewMeterException("admin-1", {
      exceptionId: "exc-1",
      decision: "REJECT",
      reason: "Reading could not be verified.",
    });

    expect(result).toEqual({ decision: "REJECT" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });

  it("refuses to review an already-reviewed exception", async () => {
    mockDb.meterException.findUnique.mockResolvedValue(
      makePendingException({ status: "APPROVED" }),
    );

    await expect(
      reviewMeterException("admin-1", {
        exceptionId: "exc-1",
        decision: "REJECT",
        reason: "Double review attempt.",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
