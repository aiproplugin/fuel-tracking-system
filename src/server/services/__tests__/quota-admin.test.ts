import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    quotaSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    company: { findUnique: vi.fn(), update: vi.fn() },
    vehicleType: { findUnique: vi.fn(), update: vi.fn() },
    vehicle: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    quotaTopUp: { create: vi.fn(), aggregate: vi.fn() },
    quotaOverrideCode: { create: vi.fn() },
    fuelTransaction: { aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { startOfColomboDay } from "@/lib/format";
import type { Actor } from "@/server/services/actor";
import {
  bulkAssignQuota,
  grantTopUp,
  hashOverrideCode,
  issueOverrideCode,
  setVehicleQuota,
  updateQuotaSettings,
} from "@/server/services/quota.service";

const D = (value: string | number) => new Prisma.Decimal(value);

function auditArg(index = 0) {
  return (mockDb.auditLog.create.mock.calls[index]?.[0] as { data: Record<string, unknown> })
    .data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.quotaSettings.findUnique.mockResolvedValue(null);
});

describe("updateQuotaSettings", () => {
  it("upserts the singleton row and audits QUOTA_SETTINGS_CHANGED with before/after", async () => {
    mockDb.quotaSettings.upsert.mockResolvedValue({});
    mockDb.quotaSettings.findUnique
      .mockResolvedValueOnce(null) // before: defaults
      .mockResolvedValueOnce({
        id: 1,
        enforcementEnabled: true,
        enforcementMode: "HARD_BLOCK",
        warningThresholdPct: 75,
        weekStartDay: "SUNDAY",
        globalQuotaLiters: D("1000"),
        globalQuotaPeriod: "MONTHLY",
        updatedAt: new Date(),
      });

    const after = await updateQuotaSettings("admin-1", {
      enforcementEnabled: true,
      enforcementMode: "HARD_BLOCK",
      warningThresholdPct: 75,
      weekStartDay: "SUNDAY",
      globalQuota: { liters: 1000, period: "MONTHLY" },
    });

    expect(after.globalQuotaLiters).toBe(1000);
    expect(after.globalQuotaPeriod).toBe("MONTHLY");
    const upsertArg = mockDb.quotaSettings.upsert.mock.calls[0]?.[0] as {
      where: { id: number };
    };
    expect(upsertArg.where.id).toBe(1);
    expect(auditArg().action).toBe("QUOTA_SETTINGS_CHANGED");
  });
});

describe("setVehicleQuota", () => {
  it("stores the CUSTOM pair together and audits QUOTA_ASSIGNED", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      quotaMode: "INHERIT",
      customQuotaLiters: null,
      customQuotaPeriod: null,
    });
    mockDb.vehicle.update.mockResolvedValue({});

    await setVehicleQuota("admin-1", {
      vehicleId: "veh-1",
      mode: "CUSTOM",
      quota: { liters: 800, period: "WEEKLY" },
    });

    const updateData = (
      mockDb.vehicle.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(updateData.quotaMode).toBe("CUSTOM");
    expect((updateData.customQuotaLiters as Prisma.Decimal).toNumber()).toBe(800);
    expect(updateData.customQuotaPeriod).toBe("WEEKLY");
    expect(auditArg().action).toBe("QUOTA_ASSIGNED");
  });

  it("EXEMPT clears the pair — a mode without a pair never keeps stale values", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      quotaMode: "CUSTOM",
      customQuotaLiters: D("800"),
      customQuotaPeriod: "WEEKLY",
    });
    mockDb.vehicle.update.mockResolvedValue({});

    await setVehicleQuota("admin-1", { vehicleId: "veh-1", mode: "EXEMPT", quota: null });

    const updateData = (
      mockDb.vehicle.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(updateData).toEqual({
      quotaMode: "EXEMPT",
      customQuotaLiters: null,
      customQuotaPeriod: null,
    });
  });
});

describe("bulkAssignQuota", () => {
  it("sets a CUSTOM pair on all active vehicles of a company and audits the count", async () => {
    mockDb.vehicle.updateMany.mockResolvedValue({ count: 7 });

    const result = await bulkAssignQuota("admin-1", {
      scope: "COMPANY",
      scopeId: "co-1",
      quota: { liters: 500, period: "DAILY" },
    });

    expect(result.vehiclesAffected).toBe(7);
    const arg = mockDb.vehicle.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({ isActive: true, companyId: "co-1" });
    expect(arg.data.quotaMode).toBe("CUSTOM");
    expect(auditArg().action).toBe("QUOTA_ASSIGNED");
    expect((auditArg().after as { vehiclesAffected: number }).vehiclesAffected).toBe(7);
  });

  it("clearing resets vehicles to INHERIT with a null pair", async () => {
    mockDb.vehicle.updateMany.mockResolvedValue({ count: 3 });

    await bulkAssignQuota("admin-1", { scope: "VEHICLE_TYPE", scopeId: "vt-1", quota: null });

    const arg = mockDb.vehicle.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(arg.where).toMatchObject({ isActive: true, vehicleTypeId: "vt-1" });
    expect(arg.data).toEqual({
      quotaMode: "INHERIT",
      customQuotaLiters: null,
      customQuotaPeriod: null,
    });
  });
});

describe("grantTopUp", () => {
  const quotaVehicle = {
    id: "veh-1",
    plateNumber: "CAB-4587",
    isActive: true,
    quotaMode: "CUSTOM",
    customQuotaLiters: D("100"),
    customQuotaPeriod: "DAILY",
    company: { id: "co-1", name: "Multilac", defaultQuotaLiters: null, defaultQuotaPeriod: null },
    vehicleType: { id: "vt-1", name: "Truck", defaultQuotaLiters: null, defaultQuotaPeriod: null },
  };

  it("freezes the CURRENT period window at grant time and audits QUOTA_TOPUP", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue(quotaVehicle);
    mockDb.quotaTopUp.create.mockResolvedValue({ id: "topup-1" });

    await grantTopUp("admin-1", { vehicleId: "veh-1", liters: 50, reason: "Emergency delivery" });

    const createData = (
      mockDb.quotaTopUp.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    // DAILY quota -> the frozen window is today's Colombo day.
    expect((createData.windowStart as Date).toISOString()).toBe(
      startOfColomboDay(new Date()).toISOString(),
    );
    const windowMs =
      (createData.windowEnd as Date).getTime() - (createData.windowStart as Date).getTime();
    expect(windowMs).toBe(24 * 3_600_000);
    expect(auditArg().action).toBe("QUOTA_TOPUP");
  });

  it("refuses a top-up for a vehicle without an active quota", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({
      ...quotaVehicle,
      quotaMode: "EXEMPT",
      customQuotaLiters: null,
      customQuotaPeriod: null,
    });

    await expect(
      grantTopUp("admin-1", { vehicleId: "veh-1", liters: 50, reason: "No quota here" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.quotaTopUp.create).not.toHaveBeenCalled();
  });
});

describe("issueOverrideCode", () => {
  const supervisor: Actor = { id: "sup-1", role: "SUPERVISOR", siteId: "site-1" };

  it("returns a 6-digit code once, stores only its hash, audits QUOTA_OVERRIDE_CODE_ISSUED", async () => {
    mockDb.vehicle.findUnique.mockResolvedValue({
      id: "veh-1",
      plateNumber: "CAB-4587",
      isActive: true,
    });
    mockDb.quotaOverrideCode.create.mockResolvedValue({ id: "code-1" });

    const result = await issueOverrideCode(supervisor, {
      vehicleId: "veh-1",
      reason: "Vehicle must finish the delivery run",
    });

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.plateNumber).toBe("CAB-4587");

    const createData = (
      mockDb.quotaOverrideCode.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(createData.codeHash).toBe(hashOverrideCode(result.code));
    expect(createData.codeHash).not.toBe(result.code);
    expect(createData.issuedById).toBe("sup-1");

    const audit = auditArg();
    expect(audit.action).toBe("QUOTA_OVERRIDE_CODE_ISSUED");
    // Neither the plaintext code nor its hash may reach the audit log.
    expect(audit.after).not.toHaveProperty("code");
    expect(audit.after).not.toHaveProperty("codeHash");
  });
});
