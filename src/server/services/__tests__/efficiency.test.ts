import { describe, expect, it } from "vitest";
import {
  computeEfficiency,
  isAbnormalConsumption,
  MAX_STORABLE_EFFICIENCY,
} from "@/server/services/efficiency";

/**
 * ONE code path for every meter type: the math is identical for DISTANCE
 * (km/L), HOURS (hrs/L), and ENERGY (kWh/L) — only the unit interpretation
 * differs. The per-type cases below pin that down.
 */
describe("computeEfficiency", () => {
  it("returns null on the first fill (no baseline) — expected, not an error", () => {
    expect(computeEfficiency(125_120, null)).toBeNull();
  });

  it("computes DISTANCE meter delta over the PREVIOUS fill's liters (km/L)", () => {
    // (125120 - 124880) / 42 = 5.714… -> 5.71 km/L
    expect(computeEfficiency(125_120, { reading: 124_880, liters: 42 })).toBe(5.71);
  });

  it("computes HOURS meter delta over the PREVIOUS fill's liters (hrs/L)", () => {
    // (3432 - 3420) / 10 = 1.20 hrs/L — inside the Forklift band 0.8–2.5
    expect(computeEfficiency(3_432, { reading: 3_420, liters: 10 })).toBe(1.2);
  });

  it("computes ENERGY meter delta over the PREVIOUS fill's liters (kWh/L)", () => {
    // (128750 - 128400) / 100 = 3.50 kWh/L — inside the Generator band 2.5–4.0
    expect(computeEfficiency(128_750, { reading: 128_400, liters: 100 })).toBe(3.5);
  });

  it("returns 0 for zero delta (same reading)", () => {
    expect(computeEfficiency(124_880, { reading: 124_880, liters: 42 })).toBe(0);
  });

  it("returns null for negative delta (callers block regressions first)", () => {
    expect(computeEfficiency(124_000, { reading: 124_880, liters: 42 })).toBeNull();
  });

  it("guards against zero/negative previous liters", () => {
    expect(computeEfficiency(125_120, { reading: 124_880, liters: 0 })).toBeNull();
  });

  it("clamps at the Decimal(6,2) storage bound", () => {
    expect(computeEfficiency(1_000_000, { reading: 0, liters: 1 })).toBe(MAX_STORABLE_EFFICIENCY);
  });
});

describe("isAbnormalConsumption", () => {
  const band = { minEfficiency: 2, maxEfficiency: 6 };

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

  it("flags too-high efficiency (meter inflation)", () => {
    expect(isAbnormalConsumption(6.01, band)).toBe(true);
    expect(isAbnormalConsumption(56, band)).toBe(true);
  });

  it("applies HOURS bands identically (hrs/L, higher is better)", () => {
    const forklift = { minEfficiency: 0.8, maxEfficiency: 2.5 };
    expect(isAbnormalConsumption(1.2, forklift)).toBe(false);
    expect(isAbnormalConsumption(0.5, forklift)).toBe(true); // burning too much fuel per hour
    expect(isAbnormalConsumption(3.0, forklift)).toBe(true); // hour-meter inflation
  });

  it("applies ENERGY bands identically (kWh/L, higher is better)", () => {
    const generator = { minEfficiency: 2.5, maxEfficiency: 4.0 };
    expect(isAbnormalConsumption(3.5, generator)).toBe(false);
    expect(isAbnormalConsumption(2.0, generator)).toBe(true); // poor generation per litre
    expect(isAbnormalConsumption(4.5, generator)).toBe(true); // meter inflation
  });
});
