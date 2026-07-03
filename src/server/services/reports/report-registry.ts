import type { ReportKey } from "@/lib/schemas/reports";

/**
 * Report catalogue — pure metadata (no query logic, no imports from the
 * service, so there is no import cycle). The service dispatches on `key`; the
 * router and UI use this to list reports and decide which filters/exports to
 * show. `requiresFlag` reports are omitted from `availableReports` and refused
 * by the service unless FEATURE_DRIVER_REPORTS is on.
 */
export interface ReportDescriptor {
  key: ReportKey;
  title: string;
  description: string;
  /** Formatted .xlsx export offered in addition to CSV (management summaries). */
  xlsx: boolean;
  /** Gated behind FEATURE_DRIVER_REPORTS. */
  requiresFlag: boolean;
  /** Uses the date-range filter (snapshot reports do not). */
  timeFiltered: boolean;
  filters: { site: boolean; vehicle: boolean; tank: boolean };
}

export const REPORT_DESCRIPTORS: Record<ReportKey, ReportDescriptor> = {
  "vehicle-usage": {
    key: "vehicle-usage",
    title: "Per-vehicle fuel usage",
    description: "Every fuel issue for the selected vehicles, tank, and date range.",
    xlsx: false,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: true, tank: true },
  },
  "vehicle-monthly": {
    key: "vehicle-monthly",
    title: "Per-vehicle monthly summary",
    description: "Liters, distance, and km/L per vehicle per calendar month.",
    xlsx: true,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: true, tank: false },
  },
  "vehicle-efficiency": {
    key: "vehicle-efficiency",
    title: "Per-vehicle efficiency",
    description: "Fleet efficiency ranking with per-vehicle drill-down.",
    xlsx: true,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: true, tank: false },
  },
  "tank-ledger": {
    key: "tank-ledger",
    title: "Tank stock-movement ledger",
    description: "Append-only stock movements with running balance_after.",
    xlsx: false,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: false, tank: true },
  },
  "delivery-history": {
    key: "delivery-history",
    title: "Delivery history",
    description: "Fuel deliveries received into tanks.",
    xlsx: false,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: false, tank: true },
  },
  "abnormal-consumption": {
    key: "abnormal-consumption",
    title: "Abnormal consumption",
    description: "Transactions flagged outside their vehicle type's km/L band.",
    xlsx: false,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: true, tank: false },
  },
  "low-stock": {
    key: "low-stock",
    title: "Low stock",
    description: "Tanks currently at or below their low-stock threshold.",
    xlsx: false,
    requiresFlag: false,
    timeFiltered: false,
    filters: { site: true, vehicle: false, tank: false },
  },
  "driver-usage": {
    key: "driver-usage",
    title: "Per-driver fuel usage",
    description: "Fuel issued per driver (enabled via FEATURE_DRIVER_REPORTS).",
    xlsx: false,
    requiresFlag: true,
    timeFiltered: true,
    filters: { site: true, vehicle: false, tank: false },
  },
};

/** Reports visible to the UI/API given whether driver reports are enabled. */
export function availableReports(driverReportsEnabled: boolean): ReportDescriptor[] {
  return Object.values(REPORT_DESCRIPTORS).filter(
    (descriptor) => !descriptor.requiresFlag || driverReportsEnabled,
  );
}
