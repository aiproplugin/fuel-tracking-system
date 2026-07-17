import { describe, expect, it } from "vitest";
import {
  METER_CONFIG,
  METER_TYPES,
  formatEfficiency,
  formatEfficiencyFull,
  formatMeter,
} from "@/lib/meter";

/**
 * METER_CONFIG is the ONLY home of unit strings — these tests guard both its
 * completeness (adding a MeterType without a config entry fails to compile,
 * and fails here at runtime too) and the exact display formats.
 */
describe("METER_CONFIG completeness", () => {
  it("has a full config entry for every meter type", () => {
    for (const meterType of METER_TYPES) {
      const config = METER_CONFIG[meterType];
      expect(config.unit.length).toBeGreaterThan(0);
      expect(config.meterLabel.length).toBeGreaterThan(0);
      expect(config.inputLabel).toContain(config.unit);
      expect(config.deltaLabel.length).toBeGreaterThan(0);
      expect(config.efficiencyUnit).toBe(`${config.unit}/L`);
    }
  });

  it("pins the operator input labels", () => {
    expect(METER_CONFIG.DISTANCE.inputLabel).toBe("Odometer (km)");
    expect(METER_CONFIG.HOURS.inputLabel).toBe("Hour meter (hrs)");
    expect(METER_CONFIG.ENERGY.inputLabel).toBe("Energy meter (kWh)");
  });
});

describe("formatMeter", () => {
  it("formats readings with the type's unit and thousands separators", () => {
    expect(formatMeter(124_880, "DISTANCE")).toBe("124,880 km");
    expect(formatMeter(3_420, "HOURS")).toBe("3,420 hrs");
    expect(formatMeter(128_400, "ENERGY")).toBe("128,400 kWh");
  });
});

describe("formatEfficiency / formatEfficiencyFull", () => {
  it("always renders the stored output-per-litre form", () => {
    expect(formatEfficiency(12.5, "DISTANCE")).toBe("12.50 km/L");
    expect(formatEfficiency(1.2, "HOURS")).toBe("1.20 hrs/L");
    expect(formatEfficiency(3.5, "ENERGY")).toBe("3.50 kWh/L");
  });

  it("appends the derived inverse for HOURS and ENERGY, never for DISTANCE", () => {
    expect(formatEfficiencyFull(12.5, "DISTANCE")).toBe("12.50 km/L");
    expect(formatEfficiencyFull(1.2, "HOURS")).toBe("1.20 hrs/L (0.83 L/hr)");
    expect(formatEfficiencyFull(3.5, "ENERGY")).toBe("3.50 kWh/L (0.29 L/kWh)");
  });

  it("skips the inverse at zero efficiency (no division by zero)", () => {
    expect(formatEfficiencyFull(0, "HOURS")).toBe("0.00 hrs/L");
  });
});
