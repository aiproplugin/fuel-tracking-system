import { describe, expect, it } from "vitest";
import { FUEL_CONFIG, FUEL_TYPES, fuelLabel, type FuelTypeName } from "@/lib/fuel";

/**
 * FUEL_CONFIG is the ONLY home of fuel labels and chip variants — these tests
 * guard its completeness (adding a FuelType without a config entry fails to
 * compile, and fails here at runtime too) and the exact display strings.
 */
describe("FUEL_CONFIG completeness", () => {
  it("has a full config entry for every fuel type", () => {
    for (const fuelType of FUEL_TYPES) {
      const config = FUEL_CONFIG[fuelType];
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.badgeVariant.length).toBeGreaterThan(0);
      expect(config.badgeVariantOnDark).toBe(`${config.badgeVariant}OnDark`);
    }
  });

  it("lists every configured fuel type exactly once in FUEL_TYPES", () => {
    const configured = Object.keys(FUEL_CONFIG) as FuelTypeName[];
    expect([...FUEL_TYPES].sort()).toEqual(configured.sort());
    expect(new Set(FUEL_TYPES).size).toBe(FUEL_TYPES.length);
  });

  it("gives each fuel type a distinct chip variant so they never read alike", () => {
    const variants = FUEL_TYPES.map((fuelType) => FUEL_CONFIG[fuelType].badgeVariant);
    expect(new Set(variants).size).toBe(FUEL_TYPES.length);
  });

  it("pins the display labels", () => {
    expect(fuelLabel("PETROL")).toBe("Petrol");
    expect(fuelLabel("DIESEL")).toBe("Diesel");
    expect(fuelLabel("KEROSENE")).toBe("Kerosene");
  });
});
