import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// resolveVehicleQuota is pure, but the module also builds rate limiters and
// touches db at import time in sibling exports — stub the client.
vi.mock("@/server/db", () => ({ db: {} }));

import {
  resolveVehicleQuota,
  type QuotaResolutionVehicle,
} from "@/server/services/quota.service";

const D = (value: string) => new Prisma.Decimal(value);

function vehicle(overrides: Partial<QuotaResolutionVehicle> = {}): QuotaResolutionVehicle {
  return {
    quotaMode: "INHERIT",
    customQuotaLiters: null,
    customQuotaPeriod: null,
    company: { defaultQuotaLiters: null, defaultQuotaPeriod: null },
    vehicleType: { defaultQuotaLiters: null, defaultQuotaPeriod: null },
    ...overrides,
  };
}

const noGlobal = { globalQuotaLiters: null, globalQuotaPeriod: null } as const;

describe("resolveVehicleQuota — waterfall: individual → company → type → global → none", () => {
  it("layer 1: an individual CUSTOM pair beats every default", () => {
    const resolved = resolveVehicleQuota(
      vehicle({
        quotaMode: "CUSTOM",
        customQuotaLiters: D("800"),
        customQuotaPeriod: "WEEKLY",
        company: { defaultQuotaLiters: D("500"), defaultQuotaPeriod: "DAILY" },
        vehicleType: { defaultQuotaLiters: D("300"), defaultQuotaPeriod: "MONTHLY" },
      }),
      { globalQuotaLiters: 100, globalQuotaPeriod: "DAILY" },
    );
    expect(resolved).toEqual({
      status: "QUOTA",
      liters: 800,
      period: "WEEKLY",
      source: "VEHICLE_CUSTOM",
    });
  });

  it("layer 1: EXEMPT explicitly ignores every default below", () => {
    const resolved = resolveVehicleQuota(
      vehicle({
        quotaMode: "EXEMPT",
        company: { defaultQuotaLiters: D("500"), defaultQuotaPeriod: "DAILY" },
        vehicleType: { defaultQuotaLiters: D("300"), defaultQuotaPeriod: "MONTHLY" },
      }),
      { globalQuotaLiters: 100, globalQuotaPeriod: "DAILY" },
    );
    expect(resolved).toEqual({ status: "EXEMPT" });
  });

  it("layer 2: COMPANY default beats the vehicle-type default", () => {
    // The critical pair-integrity case: company says 500/DAILY, type says
    // 500/MONTHLY. The company layer must supply BOTH values — a mixed
    // "500 / MONTHLY from two layers" result would be a desync bug.
    const resolved = resolveVehicleQuota(
      vehicle({
        company: { defaultQuotaLiters: D("500"), defaultQuotaPeriod: "DAILY" },
        vehicleType: { defaultQuotaLiters: D("500"), defaultQuotaPeriod: "MONTHLY" },
      }),
      noGlobal,
    );
    expect(resolved).toEqual({
      status: "QUOTA",
      liters: 500,
      period: "DAILY",
      source: "COMPANY_DEFAULT",
    });
  });

  it("layer 3: vehicle-type default applies when the company has none", () => {
    const resolved = resolveVehicleQuota(
      vehicle({
        vehicleType: { defaultQuotaLiters: D("300"), defaultQuotaPeriod: "DAILY" },
      }),
      { globalQuotaLiters: 1000, globalQuotaPeriod: "MONTHLY" },
    );
    expect(resolved).toEqual({
      status: "QUOTA",
      liters: 300,
      period: "DAILY",
      source: "TYPE_DEFAULT",
    });
  });

  it("layer 4: global default is the group-wide catch-all", () => {
    const resolved = resolveVehicleQuota(vehicle(), {
      globalQuotaLiters: 1000,
      globalQuotaPeriod: "MONTHLY",
    });
    expect(resolved).toEqual({
      status: "QUOTA",
      liters: 1000,
      period: "MONTHLY",
      source: "GLOBAL_DEFAULT",
    });
  });

  it("layer 5: nothing configured anywhere = unlimited", () => {
    expect(resolveVehicleQuota(vehicle(), noGlobal)).toEqual({ status: "UNLIMITED" });
  });

  it("amount and period always come from the SAME layer (never desync)", () => {
    // Three layers with three different periods: whichever layer wins, the
    // result must be one of the exact configured pairs, never a mix.
    const configured = vehicle({
      company: { defaultQuotaLiters: D("111"), defaultQuotaPeriod: "DAILY" },
      vehicleType: { defaultQuotaLiters: D("222"), defaultQuotaPeriod: "WEEKLY" },
    });
    const settings = { globalQuotaLiters: 333, globalQuotaPeriod: "MONTHLY" as const };

    const exactPairs = [
      { liters: 111, period: "DAILY" },
      { liters: 222, period: "WEEKLY" },
      { liters: 333, period: "MONTHLY" },
    ];

    const company = resolveVehicleQuota(configured, settings);
    expect(company).toMatchObject(exactPairs[0]!);

    const type = resolveVehicleQuota(
      vehicle({ vehicleType: configured.vehicleType }),
      settings,
    );
    expect(type).toMatchObject(exactPairs[1]!);

    const global = resolveVehicleQuota(vehicle(), settings);
    expect(global).toMatchObject(exactPairs[2]!);
  });

  it("a half-set pair is treated as absent (fails safe to the next layer)", () => {
    const resolved = resolveVehicleQuota(
      vehicle({
        company: { defaultQuotaLiters: D("500"), defaultQuotaPeriod: null },
        vehicleType: { defaultQuotaLiters: D("300"), defaultQuotaPeriod: "DAILY" },
      }),
      noGlobal,
    );
    expect(resolved).toEqual({
      status: "QUOTA",
      liters: 300,
      period: "DAILY",
      source: "TYPE_DEFAULT",
    });
  });
});
