import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tank: { findMany: vi.fn() },
    fuelTransaction: { findMany: vi.fn() },
    meterException: { count: vi.fn(), findMany: vi.fn() },
    stockMovement: { findMany: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { getDashboardSummary } from "@/server/services/dashboard.service";
import type { Actor } from "@/server/services/actor";

const admin: Actor = { id: "adm-1", role: "ADMIN", siteId: null };
const supervisor: Actor = { id: "sup-1", role: "SUPERVISOR", siteId: "site-main" };

// Fixed clock: 2026-07-03T06:00:00Z → Colombo midnight (todayStart) = 2026-07-02T18:30:00Z.
const NOW = new Date("2026-07-03T06:00:00.000Z");
const TODAY_TXN = new Date("2026-07-03T05:00:00.000Z"); // 10:30 Colombo, today
const THREE_DAYS_AGO = new Date("2026-06-30T05:00:00.000Z"); // within 7-day window

function tanks() {
  return [
    {
      fuelType: "PETROL",
      currentStock: new Prisma.Decimal("8420.00"),
      lowStockThreshold: new Prisma.Decimal("1000.00"),
      name: "Tank A",
    },
    {
      fuelType: "DIESEL",
      currentStock: new Prisma.Decimal("500.00"),
      lowStockThreshold: new Prisma.Decimal("1000.00"),
      name: "Tank B",
    },
  ];
}

function weekTransactions() {
  return [
    { issuedAt: TODAY_TXN, liters: new Prisma.Decimal("42.00"), isAbnormal: false },
    {
      issuedAt: new Date("2026-07-03T04:00:00.000Z"),
      liters: new Prisma.Decimal("8.00"),
      isAbnormal: true,
    },
    { issuedAt: THREE_DAYS_AGO, liters: new Prisma.Decimal("100.00"), isAbnormal: false },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  mockDb.tank.findMany.mockResolvedValue(tanks());
  mockDb.fuelTransaction.findMany.mockImplementation(
    (args: { where: { isAbnormal?: boolean } }) => {
      if (args.where.isAbnormal) {
        return Promise.resolve([
          {
            id: "ft-ab",
            efficiency: new Prisma.Decimal("3.20"),
            vehicle: { plateNumber: "PG-1204", vehicleType: { meterType: "DISTANCE" } },
            tank: { name: "Tank A" },
          },
        ]);
      }
      return Promise.resolve(weekTransactions());
    },
  );
  mockDb.meterException.count.mockResolvedValue(4);
  mockDb.meterException.findMany.mockResolvedValue([
    {
      id: "me-1",
      attemptedReading: 124100,
      previousReading: 124880,
      vehicle: { plateNumber: "CAB-4587", vehicleType: { meterType: "DISTANCE" } },
      tank: { name: "Tank A" },
    },
  ]);
  mockDb.stockMovement.findMany.mockResolvedValue([
    {
      id: BigInt(3),
      type: "ISSUE",
      quantity: new Prisma.Decimal("-42.00"),
      balanceAfter: new Prisma.Decimal("2438.00"),
      createdAt: NOW,
      tank: { name: "Tank A" },
      fuelTransaction: {
        issuedAt: TODAY_TXN,
        isAbnormal: false,
        vehicle: { plateNumber: "CAB-4587" },
      },
      delivery: null,
      adjustment: null,
    },
    {
      id: BigInt(2),
      type: "DELIVERY",
      quantity: new Prisma.Decimal("400.00"),
      balanceAfter: new Prisma.Decimal("2880.00"),
      createdAt: NOW,
      tank: { name: "Tank B" },
      fuelTransaction: null,
      delivery: { deliveredAt: THREE_DAYS_AGO, supplierName: "Lanka IOC" },
      adjustment: null,
    },
    {
      id: BigInt(1),
      type: "ADJUSTMENT",
      quantity: new Prisma.Decimal("-8.00"),
      balanceAfter: new Prisma.Decimal("2480.00"),
      createdAt: NOW,
      tank: { name: "Tank A" },
      fuelTransaction: null,
      delivery: null,
      adjustment: { adjustedAt: THREE_DAYS_AGO },
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getDashboardSummary — KPIs", () => {
  it("scopes the volume window to today when range=TODAY", async () => {
    const result = await getDashboardSummary(admin, { range: "TODAY" });
    expect(result.kpis.volumeLiters).toBe(50); // 42 + 8, excludes the 100 from 3 days ago
    expect(result.kpis.abnormalConsumption).toBe(1);
  });

  it("sums the full 7-day window when range=SEVEN_DAYS", async () => {
    const result = await getDashboardSummary(admin, { range: "SEVEN_DAYS" });
    expect(result.kpis.volumeLiters).toBe(150); // 42 + 8 + 100
    expect(result.kpis.abnormalConsumption).toBe(1);
  });

  it("derives stock and low-stock KPIs from active tanks", async () => {
    const result = await getDashboardSummary(admin, { range: "SEVEN_DAYS" });
    expect(result.kpis.petrolStockLiters).toBe(8420);
    expect(result.kpis.dieselStockLiters).toBe(500);
    expect(result.kpis.lowStockTanks).toBe(1); // Tank B below threshold
    expect(result.kpis.meterExceptionsPending).toBe(4);
  });
});

describe("getDashboardSummary — daily series", () => {
  it("returns 7 Colombo-day buckets with liters in the correct day", async () => {
    const result = await getDashboardSummary(admin, { range: "SEVEN_DAYS" });
    expect(result.dailyLiters).toHaveLength(7);
    expect(result.dailyLiters[6]!.liters).toBe(50); // today
    expect(result.dailyLiters[3]!.liters).toBe(100); // three days ago
    expect(result.dailyLiters[0]!.liters).toBe(0); // empty day is zero, not a gap
  });
});

describe("getDashboardSummary — scoping (never trust the client)", () => {
  it("pins a supervisor to their own site and ignores a supplied siteId", async () => {
    await getDashboardSummary(supervisor, { range: "TODAY", siteId: "site-other" });

    expect(mockDb.tank.findMany.mock.calls[0]![0].where).toMatchObject({ siteId: "site-main" });
    expect(mockDb.fuelTransaction.findMany.mock.calls[0]![0].where).toMatchObject({
      tank: { siteId: "site-main" },
    });
  });

  it("honours an explicit siteId for an admin", async () => {
    const result = await getDashboardSummary(admin, { range: "TODAY", siteId: "site-north" });
    expect(result.siteId).toBe("site-north");
    expect(mockDb.tank.findMany.mock.calls[0]![0].where).toMatchObject({ siteId: "site-north" });
  });

  it("applies no site filter for an admin viewing all sites", async () => {
    const result = await getDashboardSummary(admin, { range: "TODAY" });
    expect(result.siteId).toBeNull();
    expect(mockDb.tank.findMany.mock.calls[0]![0].where).not.toHaveProperty("siteId");
  });
});

describe("getDashboardSummary — alerts & activity", () => {
  it("composes the exception queue from meter, low-stock, and efficiency alerts", async () => {
    const result = await getDashboardSummary(admin, { range: "SEVEN_DAYS" });
    const kinds = result.exceptionQueue.map((item) => item.kind);
    expect(kinds).toEqual(["METER", "LOW_STOCK", "EFFICIENCY"]);
    // Per-row units come from the vehicle's meter type.
    expect(result.exceptionQueue[0]!.detail).toContain("124,100 km");
    expect(result.exceptionQueue[2]!.detail).toContain("3.20 km/L");
  });

  it("maps ledger movements to signed, status-tagged recent activity", async () => {
    const result = await getDashboardSummary(admin, { range: "SEVEN_DAYS" });
    expect(result.recentTransactions).toHaveLength(3);
    expect(result.recentTransactions[0]).toMatchObject({
      status: "ISSUED",
      vehicleLabel: "CAB-4587",
      liters: -42,
    });
    expect(result.recentTransactions[1]).toMatchObject({
      status: "DELIVERY",
      vehicleLabel: "Lanka IOC",
    });
    expect(result.recentTransactions[2]).toMatchObject({
      status: "ADJUSTMENT",
      vehicleLabel: null,
    });
  });
});
