/**
 * Efficiency rules — pure functions, no I/O, fully unit-tested.
 *
 * Definition (CLAUDE.md): efficiency = (meter_reading_now - meter_reading_previous)
 * / liters_at_previous_fill — output per litre in the vehicle type's meter
 * unit (km/L, hrs/L, kWh/L; higher is better for every type). The value
 * describes what the vehicle produced on the PREVIOUS fill. The first fill
 * has no baseline -> null (expected, not an error).
 *
 * The math is meter-type-agnostic; the type only changes units and labels
 * (see src/lib/meter.ts), so this single code path serves every MeterType.
 */

/** Decimal(6,2) column bound — clamp instead of overflowing the DB. */
export const MAX_STORABLE_EFFICIENCY = 9999.99;

export function computeEfficiency(
  currentReading: number,
  previousFill: { reading: number; liters: number } | null,
): number | null {
  if (!previousFill || previousFill.liters <= 0) {
    return null;
  }
  const meterDelta = currentReading - previousFill.reading;
  if (meterDelta < 0) {
    // Callers block regressions before ever computing efficiency.
    return null;
  }
  const raw = meterDelta / previousFill.liters;
  return Math.min(Math.round(raw * 100) / 100, MAX_STORABLE_EFFICIENCY);
}

/**
 * Abnormal-consumption check against the vehicle type's configured band
 * (band values are in the type's own efficiency unit). Too low
 * (guzzling/leak/diversion) AND too high (meter inflation) both flag.
 * Null efficiency (first fill) never flags.
 */
export function isAbnormalConsumption(
  efficiency: number | null,
  band: { minEfficiency: number; maxEfficiency: number },
): boolean {
  if (efficiency === null) {
    return false;
  }
  return efficiency < band.minEfficiency || efficiency > band.maxEfficiency;
}
