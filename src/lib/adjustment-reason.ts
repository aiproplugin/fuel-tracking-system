/**
 * THE single home for stock-adjustment reason categories — labels, helper text,
 * and chip styling.
 *
 * Every adjustment carries BOTH a structured category (this enum, for variance
 * analysis: how much loss is leak vs evaporation vs suspected theft) and the
 * free-text detail on `StockAdjustment.reason` (for the specifics). Neither
 * substitutes for the other and both are required server-side.
 *
 * The category never affects the ledger: it is descriptive metadata on the
 * adjustment record, so no stock maths anywhere branches on it. Only
 * presentation does, and all of that presentation reads from
 * ADJUSTMENT_REASON_CONFIG below. No category labels or chip variants anywhere
 * else in the codebase.
 *
 * Adding a category = one Prisma enum value + one entry here (completeness is
 * enforced by the Record type, and unit-tested against schema.prisma).
 */

/** Mirrors the Prisma enum; string union keeps this module client-safe. */
export type AdjustmentReasonName =
  "UNAUTHORIZED_EXTRACTION" | "DISPENSING_INACCURACY" | "LEAK_OR_SPILL" | "EVAPORATION_OR_SLUDGE";

/**
 * Canonical display order for the selector, chips, and report summaries.
 *
 * Kept as a literal tuple (rather than a widened AdjustmentReasonName[]) so
 * z.enum() in schemas/stock.ts can consume it directly and still infer the
 * exact union; `satisfies` keeps every entry checked against the union.
 */
export const ADJUSTMENT_REASONS = [
  "UNAUTHORIZED_EXTRACTION",
  "DISPENSING_INACCURACY",
  "LEAK_OR_SPILL",
  "EVAPORATION_OR_SLUDGE",
] as const satisfies readonly AdjustmentReasonName[];

export interface AdjustmentReasonConfig {
  /** Full label — selector, exports, audit review. */
  label: string;
  /** Compact label for table chips, where the full label would wrap. */
  shortLabel: string;
  /** Guidance shown under the option so recorders pick consistently. */
  helper: string;
  /** Badge variant on light surfaces (see components/ui/badge.tsx). */
  badgeVariant: "danger" | "warning" | "info" | "default";
}

export const ADJUSTMENT_REASON_CONFIG: Record<AdjustmentReasonName, AdjustmentReasonConfig> = {
  UNAUTHORIZED_EXTRACTION: {
    label: "Unauthorized Extraction (Suspected Theft)",
    shortLabel: "Unauthorized Extraction",
    helper: "Siphoning from storage or off-hours; unrecorded dispensing into jerrycans",
    badgeVariant: "danger",
  },
  DISPENSING_INACCURACY: {
    label: "Dispensing Inaccuracy",
    shortLabel: "Dispensing Inaccuracy",
    helper: "Logbook errors, uncalibrated flow meters, estimated equipment top-ups",
    badgeVariant: "warning",
  },
  LEAK_OR_SPILL: {
    label: "Leak or Spill",
    shortLabel: "Leak or Spill",
    helper: "Faulty nozzles, pipe corrosion, hose damage, overfill during delivery",
    badgeVariant: "info",
  },
  EVAPORATION_OR_SLUDGE: {
    label: "Evaporation or Sludge",
    shortLabel: "Evaporation or Sludge",
    helper: "Temperature/condensation loss, tank-bottom sediment accumulation",
    badgeVariant: "default",
  },
};

/** The one way to render a category in full ("Leak or Spill"). */
export function adjustmentReasonLabel(reason: AdjustmentReasonName): string {
  return ADJUSTMENT_REASON_CONFIG[reason].label;
}
