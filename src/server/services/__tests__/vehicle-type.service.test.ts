import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vehicleType: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    fuelTransaction: { count: vi.fn() },
    meterException: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { deleteVehicleType, upsertVehicleType } from "@/server/services/vehicle-type.service";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`db error ${code}`, {
    code,
    clientVersion: "6.19.3",
  });
}

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

describe("deleteVehicleType — delete-when-empty", () => {
  /** A stored type with its vehicle count, as the guard reads it. */
  function typeWithCount(vehicles: number) {
    return { ...existingType(), _count: { vehicles } };
  }

  it("deletes a type nothing references and audits VEHICLE_TYPE_DELETED", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(typeWithCount(0));
    mockDb.vehicleType.delete.mockResolvedValue({});

    await deleteVehicleType("admin-1", { id: "vt-1" });

    expect(mockDb.vehicleType.delete).toHaveBeenCalledWith({ where: { id: "vt-1" } });
    const audit = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; entityType: string; entityId: string; before: unknown };
    };
    expect(audit.data.action).toBe("VEHICLE_TYPE_DELETED");
    expect(audit.data.entityType).toBe("vehicle_type");
    expect(audit.data.entityId).toBe("vt-1");
    // The band is captured before/at deletion so the removed type is
    // reconstructible from the audit trail alone.
    expect(audit.data.before).toEqual({
      name: "Forklift",
      meterType: "HOURS",
      minEfficiency: 0.8,
      maxEfficiency: 2.5,
    });
  });

  it("blocks deletion when vehicles use the type, and writes no audit row", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(typeWithCount(3));

    await expect(deleteVehicleType("admin-1", { id: "vt-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("3 vehicles use this type"),
    });
    expect(mockDb.vehicleType.delete).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("blocks on a single attached vehicle, phrased in the singular", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(typeWithCount(1));

    await expect(deleteVehicleType("admin-1", { id: "vt-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("1 vehicle use"),
    });
    expect(mockDb.vehicleType.delete).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an unknown id", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(null);

    await expect(deleteVehicleType("admin-1", { id: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockDb.vehicleType.delete).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("maps a P2003 race (vehicle created after the count) to the same friendly error", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(typeWithCount(0));
    mockDb.vehicleType.delete.mockRejectedValue(knownRequestError("P2003"));

    await expect(deleteVehicleType("admin-1", { id: "vt-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated database error", async () => {
    mockDb.vehicleType.findUnique.mockResolvedValue(typeWithCount(0));
    mockDb.vehicleType.delete.mockRejectedValue(new Error("connection lost"));

    await expect(deleteVehicleType("admin-1", { id: "vt-1" })).rejects.toThrow("connection lost");
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
