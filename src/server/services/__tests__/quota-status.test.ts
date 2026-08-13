import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vehicle: { findMany: vi.fn() },
    fuelTransaction: { groupBy: vi.fn() },
    quotaTopUp: { groupBy: vi.fn() },
    quotaSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { getQuotaStatus } from "@/server/services/quota.service";
import type { Actor } from "@/server/services/actor";
import { testActor } from "@/server/services/__tests__/test-actor";

const D = (value: string | number) => new Prisma.Decimal(value);

const SUPERVISOR: Actor = testActor("SUPERVISOR", { id: "sup-1", siteId: "site-1" });
const MANAGER: Actor = testActor("MANAGER", { id: "man-1" });

function vehicleRow(overrides: Record<string, unknown>) {
  return {
    id: "veh-x",
    plateNumber: "XX-0000",
    quotaMode: "INHERIT",
    customQuotaLiters: null,
    customQuotaPeriod: null,
    company: { id: "co-1", name: "Macktiles", defaultQuotaLiters: null, defaultQuotaPeriod: null },
    vehicleType: { id: "vt-1", name: "Lorry", defaultQuotaLiters: null, defaultQuotaPeriod: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.quotaSettings.findUnique.mockResolvedValue({
    id: 1,
    enforcementEnabled: true,
    enforcementMode: "WARN_OVERRIDE",
    warningThresholdPct: 80,
    weekStartDay: "MONDAY",
    globalQuotaLiters: null,
    globalQuotaPeriod: null,
    updatedAt: new Date(),
  });
  mockDb.vehicle.findMany.mockResolvedValue([]);
  mockDb.fuelTransaction.groupBy.mockResolvedValue([]);
  mockDb.quotaTopUp.groupBy.mockResolvedValue([]);
});

describe("getQuotaStatus scoping", () => {
  it("pins a SUPERVISOR to vehicles that fuelled at their own site (requested siteId ignored)", async () => {
    await getQuotaStatus(SUPERVISOR, { siteId: "some-other-site" });

    const where = (
      mockDb.vehicle.findMany.mock.calls[0]?.[0] as {
        where: { fuelTransactions: { some: { tank: { siteId: string } } } };
      }
    ).where;
    expect(where.fuelTransactions.some.tank.siteId).toBe("site-1");
  });

  it("MANAGER/ADMIN see all vehicles when no site filter is requested", async () => {
    await getQuotaStatus(MANAGER, {});

    const where = (mockDb.vehicle.findMany.mock.calls[0]?.[0] as { where: object }).where;
    expect(where).not.toHaveProperty("fuelTransactions");
  });

  it("MANAGER may narrow to one site", async () => {
    await getQuotaStatus(MANAGER, { siteId: "site-2" });

    const where = (
      mockDb.vehicle.findMany.mock.calls[0]?.[0] as {
        where: { fuelTransactions: { some: { tank: { siteId: string } } } };
      }
    ).where;
    expect(where.fuelTransactions.some.tank.siteId).toBe("site-2");
  });
});

describe("getQuotaStatus rows + per-company summary", () => {
  it("computes per-vehicle usage in each vehicle's OWN period window and aggregates per company", async () => {
    mockDb.vehicle.findMany.mockResolvedValue([
      // Daily truck: custom 100/DAILY, consumed 90 -> OVER threshold zone.
      vehicleRow({
        id: "veh-daily",
        plateNumber: "CAB-4587",
        quotaMode: "CUSTOM",
        customQuotaLiters: D("100"),
        customQuotaPeriod: "DAILY",
        company: {
          id: "co-multilac",
          name: "Multilac",
          defaultQuotaLiters: null,
          defaultQuotaPeriod: null,
        },
      }),
      // Weekly car via company default 200/WEEKLY, consumed 50 -> OK.
      vehicleRow({
        id: "veh-weekly",
        plateNumber: "KV-9034",
        company: {
          id: "co-multilac",
          name: "Multilac",
          defaultQuotaLiters: D("200"),
          defaultQuotaPeriod: "WEEKLY",
        },
      }),
      // Unlimited vehicle of another company: no layers configured.
      vehicleRow({
        id: "veh-unlimited",
        plateNumber: "NC-7712",
        company: {
          id: "co-macktiles",
          name: "Macktiles",
          defaultQuotaLiters: null,
          defaultQuotaPeriod: null,
        },
      }),
    ]);

    // One groupBy per distinct period; return the matching vehicle's sum.
    mockDb.fuelTransaction.groupBy.mockImplementation(
      async ({ where }: { where: { vehicleId: { in: string[] } } }) => {
        if (where.vehicleId.in.includes("veh-daily")) {
          return [{ vehicleId: "veh-daily", _sum: { liters: D("90") } }];
        }
        if (where.vehicleId.in.includes("veh-weekly")) {
          return [{ vehicleId: "veh-weekly", _sum: { liters: D("50") } }];
        }
        return [];
      },
    );

    const result = await getQuotaStatus(MANAGER, {});

    // Two distinct period windows queried (DAILY + WEEKLY) — mixed periods
    // measure independently; the unlimited vehicle is in neither.
    expect(mockDb.fuelTransaction.groupBy).toHaveBeenCalledTimes(2);

    const byId = new Map(result.vehicles.map((row) => [row.vehicleId, row]));
    expect(byId.get("veh-daily")).toMatchObject({
      status: "QUOTA",
      period: "DAILY",
      source: "VEHICLE_CUSTOM",
      consumedLiters: 90,
      remainingLiters: 10,
      state: "APPROACHING",
    });
    expect(byId.get("veh-weekly")).toMatchObject({
      status: "QUOTA",
      period: "WEEKLY",
      source: "COMPANY_DEFAULT",
      consumedLiters: 50,
      remainingLiters: 150,
      state: "OK",
    });
    expect(byId.get("veh-unlimited")).toMatchObject({ status: "UNLIMITED", state: "UNLIMITED" });

    const multilac = result.companySummary.find((entry) => entry.companyId === "co-multilac");
    expect(multilac).toMatchObject({
      vehicleCount: 2,
      quotaVehicleCount: 2,
      totalQuotaLiters: 300,
      consumedLiters: 140,
      remainingLiters: 160,
    });
    const macktiles = result.companySummary.find((entry) => entry.companyId === "co-macktiles");
    expect(macktiles).toMatchObject({ vehicleCount: 1, quotaVehicleCount: 0 });
  });
});
