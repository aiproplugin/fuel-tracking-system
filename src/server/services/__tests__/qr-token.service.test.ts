import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vehicle: { findUnique: vi.fn() },
    qrToken: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import {
  createTokenForVehicle,
  deactivateToken,
  generateOpaqueToken,
  rotateToken,
} from "@/server/services/qr-token.service";

const UUID_PATTERN = /^FT-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  // Run transaction callbacks against the same mock client.
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockDb) => unknown) => fn(mockDb));
});

describe("generateOpaqueToken", () => {
  it("produces an opaque FT-<uuid> token (never derived from the plate)", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(UUID_PATTERN);
  });

  it("produces unique tokens", () => {
    expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
  });
});

describe("createTokenForVehicle", () => {
  it("creates a token when the vehicle has none active, and audits it", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({ id: "veh-1" });
    mockDb.qrToken.findFirst.mockResolvedValue(null);
    mockDb.qrToken.create.mockResolvedValue({ id: "tok-1" });

    const result = await createTokenForVehicle("admin-1", { vehicleId: "veh-1" });

    expect(result).toEqual({ tokenId: "tok-1" });
    const createArg = mockDb.qrToken.create.mock.calls[0]?.[0] as {
      data: { token: string; vehicleId: string };
    };
    expect(createArg.data.token).toMatch(UUID_PATTERN);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "QR_TOKEN_CREATED" }) }),
    );
  });

  it("refuses when an active token already exists (rotate instead)", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({ id: "veh-1" });
    mockDb.qrToken.findFirst.mockResolvedValue({ id: "tok-existing", isActive: true });

    await expect(createTokenForVehicle("admin-1", { vehicleId: "veh-1" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(mockDb.qrToken.create).not.toHaveBeenCalled();
  });
});

describe("rotateToken", () => {
  it("deactivates all active tokens and creates a fresh one atomically", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({ id: "veh-1" });
    mockDb.qrToken.updateMany.mockResolvedValue({ count: 1 });
    mockDb.qrToken.create.mockResolvedValue({ id: "tok-new" });

    const result = await rotateToken("admin-1", { vehicleId: "veh-1" });

    expect(result).toEqual({ tokenId: "tok-new" });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.qrToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vehicleId: "veh-1", isActive: true },
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "QR_TOKEN_ROTATED" }) }),
    );
  });

  it("rejects rotation for an unknown vehicle", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(null);
    await expect(rotateToken("admin-1", { vehicleId: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deactivateToken", () => {
  it("deactivates an active token and audits it", async () => {
    mockDb.qrToken.findUnique.mockResolvedValue({
      id: "tok-1",
      isActive: true,
      vehicleId: "veh-1",
    });
    mockDb.qrToken.update.mockResolvedValue({});

    await deactivateToken("admin-1", { tokenId: "tok-1" });

    expect(mockDb.qrToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "QR_TOKEN_DEACTIVATED" }),
      }),
    );
  });

  it("rejects tokens that are already inactive", async () => {
    mockDb.qrToken.findUnique.mockResolvedValue({ id: "tok-1", isActive: false });
    await expect(deactivateToken("admin-1", { tokenId: "tok-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
