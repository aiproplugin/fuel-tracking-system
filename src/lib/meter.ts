/**
 * THE single home for meter-type units, labels, and formatting.
 *
 * Every vehicle/asset has one monotonically-increasing usage meter; only the
 * unit and wording differ by the vehicle type's MeterType. Efficiency is
 * ALWAYS meter-delta per litre (km/L, hrs/L, kWh/L — higher is better), so
 * the engine never branches on type — only presentation does, and all of
 * that presentation reads from METER_CONFIG below. No unit strings anywhere
 * else in the codebase.
 *
 * Adding a meter type = one Prisma enum value + one entry here (completeness
 * is enforced by the Record type and unit-tested).
 */

/** Mirrors the Prisma enum; string union keeps this module client-safe. */
export type MeterTypeName = "DISTANCE" | "HOURS" | "ENERGY";

export const METER_TYPES: readonly MeterTypeName[] = ["DISTANCE", "HOURS", "ENERGY"] as const;

export interface MeterConfig {
  /** Reading unit: "km" | "hrs" | "kWh". */
  unit: string;
  /** The physical device: "Odometer" | "Hour meter" | "Energy meter". */
  meterLabel: string;
  /** Operator input label: "Odometer (km)" etc. */
  inputLabel: string;
  /** What a meter delta represents: "Distance" | "Hours run" | "Energy generated". */
  deltaLabel: string;
  /** Stored efficiency unit (output per litre): "km/L" | "hrs/L" | "kWh/L". */
  efficiencyUnit: string;
  /**
   * Familiar inverse (litres per output unit) shown ALONGSIDE the stored
   * form where it reads naturally — derived at display time, never stored.
   */
  inverseUnit: string | null;
}

export const METER_CONFIG: Record<MeterTypeName, MeterConfig> = {
  DISTANCE: {
    unit: "km",
    meterLabel: "Odometer",
    inputLabel: "Odometer (km)",
    deltaLabel: "Distance",
    efficiencyUnit: "km/L",
    inverseUnit: null,
  },
  HOURS: {
    unit: "hrs",
    meterLabel: "Hour meter",
    inputLabel: "Hour meter (hrs)",
    deltaLabel: "Hours run",
    efficiencyUnit: "hrs/L",
    inverseUnit: "L/hr",
  },
  ENERGY: {
    unit: "kWh",
    meterLabel: "Energy meter",
    inputLabel: "Energy meter (kWh)",
    deltaLabel: "Energy generated",
    efficiencyUnit: "kWh/L",
    inverseUnit: "L/kWh",
  },
};

/** "124,880 km" / "3,420 hrs" / "128,400 kWh". */
export function formatMeter(value: number, meterType: MeterTypeName): string {
  return `${value.toLocaleString("en-US")} ${METER_CONFIG[meterType].unit}`;
}

/** "12.50 km/L" / "1.20 hrs/L" / "3.50 kWh/L" — the stored form only. */
export function formatEfficiency(value: number, meterType: MeterTypeName): string {
  return `${value.toFixed(2)} ${METER_CONFIG[meterType].efficiencyUnit}`;
}

/**
 * Stored form plus the familiar inverse where one exists:
 * "1.20 hrs/L (0.83 L/hr)" / "3.50 kWh/L (0.29 L/kWh)" / "12.50 km/L".
 * Zero efficiency renders without an inverse (division guard).
 */
export function formatEfficiencyFull(value: number, meterType: MeterTypeName): string {
  const stored = formatEfficiency(value, meterType);
  const { inverseUnit } = METER_CONFIG[meterType];
  if (inverseUnit === null || value <= 0) {
    return stored;
  }
  return `${stored} (${(1 / value).toFixed(2)} ${inverseUnit})`;
}
