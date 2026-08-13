/**
 * THE single home for fuel-type labels and chip styling.
 *
 * Fuel type is a hard business boundary — a vehicle may only be fuelled from a
 * tank of the SAME type (see the FUEL_TYPE_MISMATCH hard block in
 * fuel-issue.service.ts). That comparison is a plain equality check on the
 * Prisma enum and never branches per type; only presentation does, and all of
 * that presentation reads from FUEL_CONFIG below. No fuel labels or chip
 * variants anywhere else in the codebase.
 *
 * Adding a fuel type = one Prisma enum value + one entry here (completeness is
 * enforced by the Record type and unit-tested).
 */

/** Mirrors the Prisma enum; string union keeps this module client-safe. */
export type FuelTypeName = "PETROL" | "DIESEL" | "KEROSENE";

/**
 * Canonical display order for selectors, chips, and KPI grids.
 *
 * Kept as a literal tuple (rather than a widened FuelTypeName[]) so z.enum()
 * in schemas/master-data.ts can consume it directly and still infer the exact
 * union; `satisfies` keeps every entry checked against FuelTypeName.
 */
export const FUEL_TYPES = [
  "PETROL",
  "DIESEL",
  "KEROSENE",
] as const satisfies readonly FuelTypeName[];

export interface FuelConfig {
  /** Human label: "Petrol" | "Diesel" | "Kerosene". */
  label: string;
  /** Badge variant on light surfaces (see components/ui/badge.tsx). */
  badgeVariant: "petrol" | "diesel" | "kerosene";
  /** Badge variant on the dark slate context cards. */
  badgeVariantOnDark: "petrolOnDark" | "dieselOnDark" | "keroseneOnDark";
}

export const FUEL_CONFIG: Record<FuelTypeName, FuelConfig> = {
  PETROL: {
    label: "Petrol",
    badgeVariant: "petrol",
    badgeVariantOnDark: "petrolOnDark",
  },
  DIESEL: {
    label: "Diesel",
    badgeVariant: "diesel",
    badgeVariantOnDark: "dieselOnDark",
  },
  KEROSENE: {
    label: "Kerosene",
    badgeVariant: "kerosene",
    badgeVariantOnDark: "keroseneOnDark",
  },
};

/** "Petrol" / "Diesel" / "Kerosene" — the one way to render a fuel type. */
export function fuelLabel(fuelType: FuelTypeName): string {
  return FUEL_CONFIG[fuelType].label;
}
