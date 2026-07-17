import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vehicleType: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    fuelTransaction: { count: vi.fn() },
    meterException: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { upsertVehicleType } from "@/server/services/vehicle-type.service";

function existingType(overrides: Record<string, unknown> = {}) {
  return {
    id: "vt-1",
    name: "Forklift",
    meterType: "HOURS",
    minEfficiency: new Prisma.Decimal("0.80"),
    maxEfficiency: new Prisma.Decimal("2.50"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.fuelTransaction.count.mockResolvedValue(0);
  mockDb.meterException.count.mockResolvedValue(0);
  mockDb.vehicleType.update.mockResolvedValue({ id: "vt-1" });
  mockDb.vehicleType.create.mockResolvedValue({ id: "vt-new" });
});

describe("upsertVehicleType — meter type + band", () => {
  it("creates a type with its meter type and audits as SETTINGS_CHANGED", async () => {
    const result = await upsertVehicleType("admin-1", {
      name: "Generator",
      meterType: "ENERGY",
      minEfficiency: 2.5,
      maxEfficiency: 4,
    });

    expect(result).toEqual({ id: "vt-new" });
    const createArg = mockDb.vehicleType.create.mock.calls[0]?.[0] as {
      data: { meterType: string };
    };
    expect(createArg.data.meterType).toBe("ENERGY");
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SETTINGS_CHANGED",
          after: expect.objectContaining({ meterType: "ENERGY" }),
        }),
      }),
    );
  });

  it("allows changing the meter type while the type has no recorded history", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(existingType());

    const result = await upsertVehicleType("admin-1", {
      id: "vt-1",
      name: "Forklift",
      meterType: "DISTANCE",
      minEfficiency: 3,
      maxEfficiency: 8,
    });

    expect(result).toEqual({ id: "vt-1" });
    expect(mockDb.fuelTransaction.count).toHaveBeenCalled();
    expect(mockDb.vehicleType.update).toHaveBeenCalled();
  });

  it("rejects a meter-type change once vehicles of the type have fuel transactions", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(existingType());
    mockDb.fuelTransaction.count.mockResolvedValue(7);

    await expect(
      upsertVehicleType("admin-1", {
        id: "vt-1",
        name: "Forklift",
        meterType: "DISTANCE",
        minEfficiency: 3,
        maxEfficiency: 8,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.vehicleType.update).not.toHaveBeenCalled();
  });

  it("rejects a meter-type change when a pending meter exception exists", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(existingType());
    mockDb.meterException.count.mockResolvedValue(1);

    await expect(
      upsertVehicleType("admin-1", {
        id: "vt-1",
        name: "Forklift",
        meterType: "DISTANCE",
        minEfficiency: 3,
        maxEfficiency: 8,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.vehicleType.update).not.toHaveBeenCalled();
  });

  it("updates the band without a history check when the meter type is unchanged", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(existingType());

    const result = await upsertVehicleType("admin-1", {
      id: "vt-1",
      name: "Forklift",
      meterType: "HOURS",
      minEfficiency: 1,
      maxEfficiency: 3,
    });

    expect(result).toEqual({ id: "vt-1" });
    expect(mockDb.fuelTransaction.count).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          before: expect.objectContaining({ minEfficiency: 0.8, maxEfficiency: 2.5 }),
          after: expect.objectContaining({ minEfficiency: 1, maxEfficiency: 3 }),
        }),
      }),
    );
  });
});
