import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    vehicle: { findUnique: vi.fn(), update: vi.fn() },
    tank: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    fuelTransaction: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
    quotaSettings: { findUnique: vi.fn() },
    quotaTopUp: { aggregate: vi.fn() },
    quotaOverrideCode: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    stockMovement: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { submitFuelIssue, type OperatorActor } from "@/server/services/fuel-issue.service";
import { hashOverrideCode } from "@/server/services/quota.service";
import { testActor } from "@/server/services/__tests__/test-actor";

const D = (value: string | number) => new Prisma.Decimal(value);

let actorCounter = 0;
/** Fresh actor per test — the module-level rate limiters key on actor id. */
function actor(): OperatorActor {
  actorCounter += 1;
  return testActor("OPERATOR", {
    id: `op-${actorCounter}`,
    siteId: "site-1",
    defaultTankId: "tank-1",
  });
}

const TANK = {
  id: "tank-1",
  name: "Tank A",
  fuelType: "DIESEL",
  isActive: true,
  currentStock: D("1000"),
};

/** Vehicle with a CUSTOM 100 L / DAILY quota (include shape of QUOTA_INCLUDE). */
const VEHICLE = {
  id: "veh-1",
  plateNumber: "CAB-4587",
  fuelType: "DIESEL",
  isActive: true,
  currentMeter: 1000,
  quotaMode: "CUSTOM",
  customQuotaLiters: D("100"),
  customQuotaPeriod: "DAILY",
  vehicleType: {
    id: "vt-1",
    name: "Bowser Truck",
    meterType: "DISTANCE",
    minEfficiency: D("2"),
    maxEfficiency: D("6"),
    defaultQuotaLiters: null,
    defaultQuotaPeriod: null,
  },
  company: { name: "Multilac", defaultQuotaLiters: null, defaultQuotaPeriod: null },
};

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    enforcementEnabled: true,
    enforcementMode: "WARN_OVERRIDE",
    warningThresholdPct: 80,
    weekStartDay: "MONDAY",
    globalQuotaLiters: null,
    globalQuotaPeriod: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockConsumed(liters: number) {
  // Ledger-derived consumption: the ONLY source of "used so far".
  mockDb.fuelTransaction.aggregate.mockResolvedValue({
    _count: { id: 0 },
    _sum: { liters: liters > 0 ? D(liters) : null },
  });
}

function mockTopUps(liters: number) {
  mockDb.quotaTopUp.aggregate.mockResolvedValue({
    _sum: { liters: liters > 0 ? D(liters) : null },
  });
}

function mockHappyTransaction() {
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
    callback(mockDb),
  );
  mockDb.tank.updateMany.mockResolvedValue({ count: 1 });
  mockDb.tank.findUniqueOrThrow.mockResolvedValue({ currentStock: D("980") });
  mockDb.fuelTransaction.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: "txn-1",
      liters: data.liters,
      meterReading: data.meterReading,
      efficiency: null,
      isAbnormal: false,
      meterOverride: false,
      quotaOverride: data.quotaOverride ?? false,
      issuedAt: new Date(),
    }),
  );
  mockDb.stockMovement.create.mockResolvedValue({});
  mockDb.vehicle.update.mockResolvedValue({});
}

function submitInput(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: "veh-1",
    idempotencyKey: crypto.randomUUID(),
    liters: 20,
    meterReading: 1100,
    ...overrides,
  } as Parameters<typeof submitFuelIssue>[1];
}

function auditActions(): string[] {
  return mockDb.auditLog.create.mock.calls.map(
    (call) => (call[0] as { data: { action: string } }).data.action,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.fuelTransaction.findUnique.mockResolvedValue(null); // no idempotent replay
  mockDb.fuelTransaction.findFirst.mockResolvedValue(null); // no previous fill
  mockDb.tank.findUnique.mockResolvedValue(TANK);
  mockDb.vehicle.findUnique.mockResolvedValue(VEHICLE);
  mockDb.auditLog.create.mockResolvedValue({});
  mockTopUps(0);
  mockHappyTransaction();
});

describe("master switch OFF = zero quota enforcement anywhere", () => {
  it("issues normally even when the vehicle would be far over quota", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(null); // no row -> defaults (disabled)
    mockConsumed(9999);

    const result = await submitFuelIssue(actor(), submitInput());

    expect(result.outcome).toBe("SUCCESS");
    // No quota machinery touched: no code lookup, no consumption aggregate.
    expect(mockDb.quotaOverrideCode.findFirst).not.toHaveBeenCalled();
    expect(mockDb.fuelTransaction.aggregate).not.toHaveBeenCalled();
  });
});

describe("enforcement mode OFF = informational only", () => {
  it("never blocks an over-quota issue", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(settingsRow({ enforcementMode: "OFF" }));
    mockConsumed(95); // only 5 L left of 100, requesting 20

    const result = await submitFuelIssue(actor(), submitInput());
    expect(result.outcome).toBe("SUCCESS");
  });
});

describe("HARD_BLOCK", () => {
  it("refuses an over-quota issue with QUOTA_BLOCKED and writes nothing", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(
      settingsRow({ enforcementMode: "HARD_BLOCK" }),
    );
    mockConsumed(90); // remaining 10 < requested 20

    const result = await submitFuelIssue(actor(), submitInput());

    expect(result.outcome).toBe("QUOTA_BLOCKED");
    if (result.outcome === "QUOTA_BLOCKED") {
      expect(result.quota.remainingLiters).toBe(10);
      expect(result.quota.period).toBe("DAILY");
    }
    expect(mockDb.fuelTransaction.create).not.toHaveBeenCalled();
    expect(mockDb.stockMovement.create).not.toHaveBeenCalled();
  });

  it("allows an issue that fits the remaining quota", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(
      settingsRow({ enforcementMode: "HARD_BLOCK" }),
    );
    mockConsumed(70); // remaining 30 >= requested 20

    const result = await submitFuelIssue(actor(), submitInput());
    expect(result.outcome).toBe("SUCCESS");
  });
});

describe("WARN_OVERRIDE (one-time supervisor code)", () => {
  beforeEach(() => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(settingsRow());
    mockConsumed(90); // remaining 10 < requested 20 in every test below
  });

  it("returns QUOTA_EXCEEDED (codeRejected=false) when no code is supplied", async () => {
    const result = await submitFuelIssue(actor(), submitInput());

    expect(result.outcome).toBe("QUOTA_EXCEEDED");
    if (result.outcome === "QUOTA_EXCEEDED") {
      expect(result.codeRejected).toBe(false);
    }
    expect(mockDb.fuelTransaction.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid/expired/foreign code (codeRejected=true)", async () => {
    mockDb.quotaOverrideCode.findFirst.mockResolvedValue(null);

    const result = await submitFuelIssue(actor(), submitInput({ overrideCode: "123456" }));

    expect(result.outcome).toBe("QUOTA_EXCEEDED");
    if (result.outcome === "QUOTA_EXCEEDED") {
      expect(result.codeRejected).toBe(true);
    }
    // The lookup must be by hash, vehicle-bound, unused, unexpired.
    const where = (
      mockDb.quotaOverrideCode.findFirst.mock.calls[0]?.[0] as {
        where: { vehicleId: string; codeHash: string; usedAt: null };
      }
    ).where;
    expect(where.vehicleId).toBe("veh-1");
    expect(where.codeHash).toBe(hashOverrideCode("123456"));
    expect(where.usedAt).toBeNull();
    expect(mockDb.fuelTransaction.create).not.toHaveBeenCalled();
  });

  it("completes the issue with a valid code: flags quota_override, consumes the code, audits QUOTA_OVERRIDE", async () => {
    mockDb.quotaOverrideCode.findFirst.mockResolvedValue({ id: "code-1", issuedById: "sup-1" });
    mockDb.quotaOverrideCode.updateMany.mockResolvedValue({ count: 1 });
    mockDb.quotaOverrideCode.update.mockResolvedValue({});

    const result = await submitFuelIssue(actor(), submitInput({ overrideCode: "123456" }));

    expect(result.outcome).toBe("SUCCESS");
    const createData = (
      mockDb.fuelTransaction.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(createData.quotaOverride).toBe(true);
    expect(createData.quotaOverrideById).toBe("sup-1");
    // Single use: consumed with a guarded update inside the transaction.
    expect(mockDb.quotaOverrideCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "code-1", usedAt: null } }),
    );
    expect(auditActions()).toEqual(expect.arrayContaining(["FUEL_ISSUED", "QUOTA_OVERRIDE"]));
  });

  it("treats a code that lost the single-use race as rejected", async () => {
    mockDb.quotaOverrideCode.findFirst.mockResolvedValue({ id: "code-1", issuedById: "sup-1" });
    mockDb.quotaOverrideCode.updateMany.mockResolvedValue({ count: 0 }); // already used

    const result = await submitFuelIssue(actor(), submitInput({ overrideCode: "123456" }));

    expect(result.outcome).toBe("QUOTA_EXCEEDED");
    if (result.outcome === "QUOTA_EXCEEDED") {
      expect(result.codeRejected).toBe(true);
    }
    expect(mockDb.fuelTransaction.create).not.toHaveBeenCalled();
  });
});

describe("top-ups and ledger-derived consumption", () => {
  it("a top-up extends the remaining quota inside the current window", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(
      settingsRow({ enforcementMode: "HARD_BLOCK" }),
    );
    mockConsumed(90); // base remaining 10 …
    mockTopUps(50); // … but a 50 L top-up is active -> remaining 60

    const result = await submitFuelIssue(actor(), submitInput({ liters: 20 }));
    expect(result.outcome).toBe("SUCCESS");
  });

  it("derives consumption from the fuel_transaction ledger within the period window", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(settingsRow());
    mockConsumed(0);

    await submitFuelIssue(actor(), submitInput());

    const aggregateArg = mockDb.fuelTransaction.aggregate.mock.calls[0]?.[0] as {
      where: { vehicleId: string; issuedAt: { gte: Date; lt: Date } };
      _sum: { liters: boolean };
    };
    expect(aggregateArg.where.vehicleId).toBe("veh-1");
    expect(aggregateArg.where.issuedAt.gte).toBeInstanceOf(Date);
    expect(aggregateArg.where.issuedAt.lt).toBeInstanceOf(Date);
    expect(aggregateArg._sum.liters).toBe(true);
    // DAILY quota -> a 24h window.
    const windowMs =
      aggregateArg.where.issuedAt.lt.getTime() - aggregateArg.where.issuedAt.gte.getTime();
    expect(windowMs).toBe(24 * 3_600_000);
  });

  it("an EXEMPT vehicle is never quota-checked", async () => {
    mockDb.quotaSettings.findUnique.mockResolvedValue(
      settingsRow({
        enforcementMode: "HARD_BLOCK",
        globalQuotaLiters: D("10"),
        globalQuotaPeriod: "DAILY",
      }),
    );
    mockDb.vehicle.findUnique.mockResolvedValue({
      ...VEHICLE,
      quotaMode: "EXEMPT",
      customQuotaLiters: null,
      customQuotaPeriod: null,
    });

    const result = await submitFuelIssue(actor(), submitInput({ liters: 500 }));
    expect(result.outcome).toBe("SUCCESS");
    expect(mockDb.fuelTransaction.aggregate).not.toHaveBeenCalled();
  });
});
