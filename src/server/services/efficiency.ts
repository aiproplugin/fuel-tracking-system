/**
 * Efficiency (km/L) rules — pure functions, no I/O, fully unit-tested.
 *
 * Definition (CLAUDE.md): km_per_liter = (odometer_now - odometer_previous)
 * / liters_at_previous_fill. The value describes how far the vehicle went
 * on the PREVIOUS fill. The first fill has no baseline -> null (expected,
 * not an error).
 */

/** Decimal(6,2) column bound — clamp instead of overflowing the DB. */
export const MAX_STORABLE_KM_PER_LITER = 9999.99;

export function computeKmPerLiter(
  currentOdometer: number,
  previousFill: { odometer: number; liters: number } | null,
): number | null {
  if (!previousFill || previousFill.liters <= 0) {
    return null;
  }
  const distanceKm = currentOdometer - previousFill.odometer;
  if (distanceKm < 0) {
    // Callers block regressions before ever computing efficiency.
    return null;
  }
  const raw = distanceKm / previousFill.liters;
  return Math.min(Math.round(raw * 100) / 100, MAX_STORABLE_KM_PER_LITER);
}

/**
 * Abnormal-consumption check against the vehicle type's configured band.
 * Too low (guzzling/leak/diversion) AND too high (odometer inflation) both
 * flag. Null efficiency (first fill) never flags.
 */
export function isAbnormalConsumption(
  kmPerLiter: number | null,
  band: { minKmPerLiter: number; maxKmPerLiter: number },
): boolean {
  if (kmPerLiter === null) {
    return false;
  }
  return kmPerLiter < band.minKmPerLiter || kmPerLiter > band.maxKmPerLiter;
}
