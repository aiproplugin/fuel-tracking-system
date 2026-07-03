import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockEnv } = vi.hoisted(() => ({
  mockDb: {
    fuelTransaction: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    delivery: { aggregate: vi.fn(), findMany: vi.fn() },
    stockMovement: { count: vi.fn(), findMany: vi.fn() },
    tank: { findMany: vi.fn() },
    driver: { findMany: vi.fn() },
    vehicle: { findUnique: vi.fn() },
  },
  mockEnv: { FEATURE_DRIVER_REPORTS: false },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { runReport } from "@/server/services/reports/report.service";
import type { Actor } from "@/server/services/actor";

const admin: Actor = { id: "adm-1", role: "ADMIN", siteId: null };
const supervisor: Actor = { id: "sup-1", role: "SUPERVISOR", siteId: "site-a" };

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.FEATURE_DRIVER_REPORTS = false;
  mockDb.fuelTransaction.aggregate.mockResolvedValue({
    _sum: { liters: new Prisma.Decimal("150.00") },
    _count: { _all: 3 },
  });
  mockDb.fuelTransaction.findMany.mockResolvedValue([]);
  mockDb.fuelTransaction.count.mockResolvedValue(0);
  mockDb.fuelTransaction.groupBy.mockResolvedValue([]);
  mockDb.driver.findMany.mockResolvedValue([]);
});

describe("runReport — scoping (never trust the client)", () => {
  it("pins a supervisor to their own site and ignores a supplied siteId", async () => {
    await runReport(supervisor, "vehicle-usage", { siteId: "site-b" }, { rowLimit: 500 });
    expect(mockDb.fuelTransaction.aggregate.mock.calls[0]![0].where.tank).toMatchObject({
      siteId: "site-a",
    });
  });

  it("honours an explicit siteId for an admin", async () => {
    await runReport(admin, "vehicle-usage", { siteId: "site-b" }, { rowLimit: 500 });
    expect(mockDb.fuelTransaction.aggregate.mock.calls[0]![0].where.tank).toMatchObject({
      siteId: "site-b",
    });
  });

  it("applies no site constraint for an admin viewing all sites", async () => {
    await runReport(admin, "vehicle-usage", {}, { rowLimit: 500 });
    expect(mockDb.fuelTransaction.aggregate.mock.calls[0]![0].where.tank).toBeUndefined();
  });
});

describe("runReport — ledger-sourced totals", () => {
  it("takes the usage total from the DB aggregate, not the capped rows", async () => {
    const result = await runReport(admin, "vehicle-usage", {}, { rowLimit: 500 });
    expect(result.totalRows).toBe(3);
    expect(result.summary).toContainEqual({ label: "Total liters", value: "150 L" });
  });
});

describe("runReport — per-vehicle monthly aggregation", () => {
  it("sums liters and per-fill distance, deriving km/L", async () => {
    mockDb.fuelTransaction.findMany.mockResolvedValueOnce([
      {
        vehicleId: "v1",
        issuedAt: new Date("2026-07-03T05:00:00.000Z"),
        liters: new Prisma.Decimal("50.00"),
        odometer: 1000,
        previousOdometer: 900,
        kmPerLiter: null,
        isAbnormal: false,
        vehicle: { plateNumber: "CAB-1", vehicleType: { name: "Truck" } },
      },
      {
        vehicleId: "v1",
        issuedAt: new Date("2026-07-10T05:00:00.000Z"),
        liters: new Prisma.Decimal("50.00"),
        odometer: 1200,
        previousOdometer: 1000,
        kmPerLiter: null,
        isAbnormal: false,
        vehicle: { plateNumber: "CAB-1", vehicleType: { name: "Truck" } },
      },
    ]);

    const result = await runReport(admin, "vehicle-monthly", {}, { rowLimit: 500 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ liters: 100, km: 300, kmPerLiter: 3 });
  });
});

describe("runReport — driver-report feature gate", () => {
  it("hides the driver report as NOT_FOUND when the flag is off", async () => {
    await expect(runReport(admin, "driver-usage", {}, { rowLimit: 500 })).rejects.toThrow(
      "Report not found",
    );
  });

  it("runs the driver report when the flag is on", async () => {
    mockEnv.FEATURE_DRIVER_REPORTS = true;
    const result = await runReport(admin, "driver-usage", {}, { rowLimit: 500 });
    expect(result.key).toBe("driver-usage");
    expect(result.columns.map((column) => column.key)).toContain("driver");
  });
});
