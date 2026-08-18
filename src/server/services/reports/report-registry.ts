import type { AuditAction } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
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
  /**
   * EXTRA permission required on top of report.run / report.export.
   *
   * `report.run` and `report.export` unlock the reporting CAPABILITY, not every
   * dataset reachable through it — SUPERVISOR holds both but deliberately does
   * NOT hold `audit.view`. Without this gate, adding an audit report to the
   * catalogue would hand the whole audit trail to every supervisor. Enforced in
   * runReport, which is the single dispatch point for the on-screen query AND
   * the export route, so one check covers both.
   */
  requiredPermission?: Permission;
  /**
   * Fixed scope note, for reports that do not go through site scoping at all.
   * Without it the generic note ("All sites") would imply a site dimension the
   * report does not have.
   */
  scopeNote?: string;
  /**
   * Audit action written when this report is exported. Defaults to
   * REPORT_EXPORTED; the audit trail uses its own action so "who read the
   * audit trail" stays greppable rather than buried among ordinary exports.
   */
  exportAuditAction?: AuditAction;
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
    description: "Liters, meter delta, and efficiency per vehicle per calendar month.",
    xlsx: true,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: true, tank: false },
  },
  "vehicle-efficiency": {
    key: "vehicle-efficiency",
    title: "Per-vehicle efficiency",
    description: "Efficiency ranking per meter type with per-vehicle drill-down.",
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
  "adjustment-register": {
    key: "adjustment-register",
    title: "Adjustment register",
    description: "Stock adjustments by reason category, with litres of variance per category.",
    xlsx: true,
    requiresFlag: false,
    timeFiltered: true,
    filters: { site: true, vehicle: false, tank: true },
  },
  "abnormal-consumption": {
    key: "abnormal-consumption",
    title: "Abnormal consumption",
    description: "Transactions flagged outside their vehicle type's efficiency band.",
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
  "audit-trail": {
    key: "audit-trail",
    title: "Audit trail",
    description:
      "Append-only compliance record for a date range: actor, action, entity, before/after, and IP.",
    xlsx: true,
    requiresFlag: false,
    timeFiltered: true,
    // The trail is never site-scoped: audit.view is all-or-nothing, so no site
    // filter is offered and resolveScope is not consulted for this report.
    filters: { site: false, vehicle: false, tank: false },
    requiredPermission: "audit.view",
    exportAuditAction: "AUDIT_EXPORTED",
    scopeNote: "Entire audit trail (not site-scoped)",
  },
};

/**
 * Reports visible to the UI/API for this actor.
 *
 * Filters on BOTH the feature flag and the actor's effective permissions, so a
 * report the caller may not run is never advertised. This is a listing
 * convenience, not the gate — runReport re-checks `requiredPermission` on every
 * call and is what actually enforces access.
 */
export function availableReports(
  driverReportsEnabled: boolean,
  permissions: ReadonlySet<string>,
): ReportDescriptor[] {
  return Object.values(REPORT_DESCRIPTORS).filter(
    (descriptor) =>
      (!descriptor.requiresFlag || driverReportsEnabled) &&
      (!descriptor.requiredPermission || permissions.has(descriptor.requiredPermission)),
  );
}
