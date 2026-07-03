import { describe, expect, it } from "vitest";
import {
  computeKmPerLiter,
  isAbnormalConsumption,
  MAX_STORABLE_KM_PER_LITER,
} from "@/server/services/efficiency";

describe("computeKmPerLiter", () => {
  it("returns null on the first fill (no baseline) — expected, not an error", () => {
    expect(computeKmPerLiter(125_120, null)).toBeNull();
  });

  it("computes distance over the PREVIOUS fill's liters", () => {
    // (125120 - 124880) / 42 = 5.714… -> 5.71
    expect(computeKmPerLiter(125_120, { odometer: 124_880, liters: 42 })).toBe(5.71);
  });

  it("returns 0 for zero distance (same odometer)", () => {
    expect(computeKmPerLiter(124_880, { odometer: 124_880, liters: 42 })).toBe(0);
  });

  it("returns null for negative distance (callers block regressions first)", () => {
    expect(computeKmPerLiter(124_000, { odometer: 124_880, liters: 42 })).toBeNull();
  });

  it("guards against zero/negative previous liters", () => {
    expect(computeKmPerLiter(125_120, { odometer: 124_880, liters: 0 })).toBeNull();
  });

  it("clamps at the Decimal(6,2) storage bound", () => {
    expect(computeKmPerLiter(1_000_000, { odometer: 0, liters: 1 })).toBe(
      MAX_STORABLE_KM_PER_LITER,
    );
  });
});

describe("isAbnormalConsumption", () => {
  const band = { minKmPerLiter: 2, maxKmPerLiter: 6 };

  it("never flags a first fill (null efficiency)", () => {
    expect(isAbnormalConsumption(null, band)).toBe(false);
  });

  it("accepts values inside the band (inclusive bounds)", () => {
    expect(isAbnormalConsumption(2, band)).toBe(false);
    expect(isAbnormalConsumption(4.5, band)).toBe(false);
    expect(isAbnormalConsumption(6, band)).toBe(false);
  });

  it("flags too-low efficiency (leak/diversion/guzzling)", () => {
    expect(isAbnormalConsumption(1.99, band)).toBe(true);
    expect(isAbnormalConsumption(0, band)).toBe(true);
  });

  it("flags too-high efficiency (odometer inflation)", () => {
    expect(isAbnormalConsumption(6.01, band)).toBe(true);
    expect(isAbnormalConsumption(56, band)).toBe(true);
  });
});
