import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockEnv } = vi.hoisted(() => ({
  mockDb: {
    fuelTransaction: { aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    delivery: { aggregate: vi.fn(), findMany: vi.fn() },
    stockMovement: { count: vi.fn(), findMany: vi.fn() },
    stockAdjustment: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
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
import { testActor } from "@/server/services/__tests__/test-actor";

const admin: Actor = testActor("ADMIN", { id: "adm-1" });
const supervisor: Actor = testActor("SUPERVISOR", { id: "sup-1", siteId: "site-a" });

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

function fill(overrides: Record<string, unknown>) {
  return {
    vehicleId: "v1",
    issuedAt: new Date("2026-07-03T05:00:00.000Z"),
    liters: new Prisma.Decimal("50.00"),
    meterReading: 1000,
    previousMeterReading: 900,
    efficiency: null,
    isAbnormal: false,
    vehicle: { plateNumber: "CAB-1", vehicleType: { name: "Truck", meterType: "DISTANCE" } },
    ...overrides,
  };
}

/** One DISTANCE truck + one HOURS forklift + one ENERGY generator in scope. */
function mixedFleetFills() {
  return [
    fill({ meterReading: 1000, previousMeterReading: 900 }), // truck: 100 km / 50 L
    fill({ meterReading: 1200, previousMeterReading: 1000 }), // truck: 200 km / 50 L
    fill({
      vehicleId: "v2",
      meterReading: 3_432,
      previousMeterReading: 3_420,
      liters: new Prisma.Decimal("10.00"),
      vehicle: { plateNumber: "FL-2201", vehicleType: { name: "Forklift", meterType: "HOURS" } },
    }), // forklift: 12 hrs / 10 L = 1.20 hrs/L
    fill({
      vehicleId: "v3",
      meterReading: 128_750,
      previousMeterReading: 128_400,
      liters: new Prisma.Decimal("100.00"),
      vehicle: { plateNumber: "GEN-01", vehicleType: { name: "Generator", meterType: "ENERGY" } },
    }), // generator: 350 kWh / 100 L = 3.50 kWh/L
  ];
}

describe("runReport — per-vehicle monthly aggregation", () => {
  it("sums liters and per-fill meter delta, deriving efficiency", async () => {
    mockDb.fuelTransaction.findMany.mockResolvedValueOnce([
      fill({ meterReading: 1000, previousMeterReading: 900 }),
      fill({
        issuedAt: new Date("2026-07-10T05:00:00.000Z"),
        meterReading: 1200,
        previousMeterReading: 1000,
      }),
    ]);

    const result = await runReport(admin, "vehicle-monthly", {}, { rowLimit: 500 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ liters: 100, meterDelta: 300, efficiency: 3 });
    expect(result.rows[0]).toMatchObject({ _meterType: "DISTANCE" });
  });

  it("totals liters fleet-wide but meter deltas per meter type only", async () => {
    mockDb.fuelTransaction.findMany.mockResolvedValueOnce(mixedFleetFills());

    const result = await runReport(admin, "vehicle-monthly", {}, { rowLimit: 500 });

    expect(result.summary).toContainEqual({ label: "Total liters", value: "210 L" });
    expect(result.summary).toContainEqual({ label: "Total distance", value: "300 km" });
    expect(result.summary).toContainEqual({ label: "Total hours run", value: "12 hrs" });
    expect(result.summary).toContainEqual({ label: "Total energy generated", value: "350 kWh" });
    // No summed 300+12+350 figure may exist anywhere.
    expect(result.summary.some((item) => item.value.startsWith("662"))).toBe(false);
  });
});

describe("runReport — vehicle efficiency (never mixes meter types)", () => {
  it("groups rows by meter type and emits one fleet tile per type present", async () => {
    mockDb.fuelTransaction.findMany.mockResolvedValueOnce(mixedFleetFills());

    const result = await runReport(admin, "vehicle-efficiency", {}, { rowLimit: 500 });

    // Rows sorted by meter type group; each carries its own meter type.
    expect(result.rows.map((row) => row["_meterType"])).toEqual(["DISTANCE", "ENERGY", "HOURS"]);
    expect(result.rows.find((row) => row["plate"] === "CAB-1")).toMatchObject({
      meterDelta: 300,
      efficiency: 3,
    });
    expect(result.rows.find((row) => row["plate"] === "FL-2201")).toMatchObject({
      meterDelta: 12,
      efficiency: 1.2,
    });
    expect(result.rows.find((row) => row["plate"] === "GEN-01")).toMatchObject({
      meterDelta: 350,
      efficiency: 3.5,
    });

    // One per-type fleet tile each; NO single cross-type "fleet efficiency".
    expect(result.summary).toContainEqual({ label: "Fleet km/L", value: "3.00 km/L" });
    expect(result.summary).toContainEqual({ label: "Fleet hrs/L", value: "1.20 hrs/L" });
    expect(result.summary).toContainEqual({ label: "Fleet kWh/L", value: "3.50 kWh/L" });
    expect(result.summary.filter((item) => item.label.startsWith("Fleet"))).toHaveLength(3);
  });
});

describe("runReport — adjustment register (loss by reason category)", () => {
  beforeEach(() => {
    mockDb.stockAdjustment.aggregate.mockResolvedValue({
      _sum: { quantityChange: new Prisma.Decimal("-45.00") },
      _count: { _all: 3 },
    });
    mockDb.stockAdjustment.groupBy.mockResolvedValue([
      {
        reasonCategory: "LEAK_OR_SPILL",
        _sum: { quantityChange: new Prisma.Decimal("-25.00") },
        _count: { _all: 1 },
      },
      {
        reasonCategory: "EVAPORATION_OR_SLUDGE",
        _sum: { quantityChange: new Prisma.Decimal("-12.00") },
        _count: { _all: 1 },
      },
      {
        reasonCategory: "UNAUTHORIZED_EXTRACTION",
        _sum: { quantityChange: new Prisma.Decimal("-8.00") },
        _count: { _all: 1 },
      },
    ]);
    mockDb.stockAdjustment.findMany.mockResolvedValue([
      {
        adjustedAt: new Date("2026-07-02T04:30:00.000Z"),
        createdAt: new Date("2026-07-02T04:30:00.000Z"),
        quantityChange: new Prisma.Decimal("-25.00"),
        reasonCategory: "LEAK_OR_SPILL",
        reason: "Nozzle drip found at the July dip check.",
        tank: { name: "Multilac" },
        adjustedBy: { displayName: "Sunil P." },
        movement: { balanceAfter: new Prisma.Decimal("1745.00") },
      },
    ]);
  });

  it("exports the category and the detail as separate columns", async () => {
    const result = await runReport(admin, "adjustment-register", {}, { rowLimit: 500 });

    expect(result.columns.map((column) => column.key)).toEqual([
      "adjustedAt",
      "tank",
      "change",
      "reasonCategory",
      "detail",
      "adjustedBy",
      "balanceAfter",
    ]);
    expect(result.rows[0]).toMatchObject({
      reasonCategory: "Leak or Spill",
      detail: "Nozzle drip found at the July dip check.",
      change: -25,
    });
  });

  it("totals litres per category from the whole filtered set, listing every category", async () => {
    const result = await runReport(admin, "adjustment-register", {}, { rowLimit: 500 });

    expect(result.summary).toContainEqual({ label: "Leak or Spill", value: "-25 L (1)" });
    expect(result.summary).toContainEqual({ label: "Evaporation or Sludge", value: "-12 L (1)" });
    expect(result.summary).toContainEqual({
      label: "Unauthorized Extraction (Suspected Theft)",
      value: "-8 L (1)",
    });
    // Categories with no rows this period still appear, so exports keep shape.
    expect(result.summary).toContainEqual({ label: "Dispensing Inaccuracy", value: "0 L (0)" });
    expect(result.summary).toContainEqual({ label: "Net change", value: "-45 L" });
    // Totals come from the aggregate, never from the (capped) page of rows.
    expect(result.totalRows).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("pins a supervisor to their own site", async () => {
    await runReport(supervisor, "adjustment-register", { siteId: "site-b" }, { rowLimit: 500 });
    expect(mockDb.stockAdjustment.aggregate.mock.calls[0]![0].where.tank).toMatchObject({
      siteId: "site-a",
    });
  });
});

describe("runReport — tank ledger carries the adjustment category", () => {
  it("fills the category only for adjustment movements", async () => {
    mockDb.stockMovement.count.mockResolvedValue(2);
    mockDb.stockMovement.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-07-02T04:30:00.000Z"),
        type: "ADJUSTMENT",
        quantity: new Prisma.Decimal("-25.00"),
        balanceAfter: new Prisma.Decimal("1745.00"),
        tank: { name: "Multilac" },
        fuelTransaction: null,
        delivery: null,
        adjustment: { reason: "Nozzle drip", reasonCategory: "LEAK_OR_SPILL" },
      },
      {
        createdAt: new Date("2026-07-02T03:00:00.000Z"),
        type: "DELIVERY",
        quantity: new Prisma.Decimal("2000.00"),
        balanceAfter: new Prisma.Decimal("1770.00"),
        tank: { name: "Multilac" },
        fuelTransaction: null,
        delivery: { supplierName: "Lanka IOC", referenceNo: "INV-88" },
        adjustment: null,
      },
    ]);

    const result = await runReport(admin, "tank-ledger", {}, { rowLimit: 500 });

    expect(result.columns.map((column) => column.key)).toContain("reasonCategory");
    expect(result.rows[0]).toMatchObject({ type: "ADJUSTMENT", reasonCategory: "Leak or Spill" });
    expect(result.rows[1]).toMatchObject({ type: "DELIVERY", reasonCategory: "" });
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
