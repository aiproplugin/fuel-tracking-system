"use client";

import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReportKey } from "@/lib/schemas/reports";
import type { ReportDescriptor } from "@/server/services/reports/report-registry";
import type { ReportFilterState } from "@/components/admin/reports/report-filters";

/**
 * CSV/XLSX download links. The href points at the server export route, which
 * re-runs the same scoped report — the browser only carries the current filter
 * selection, never assembled data. Only filters the report supports are sent.
 */
function buildHref(
  reportKey: ReportKey,
  descriptor: ReportDescriptor,
  format: "csv" | "xlsx",
  state: ReportFilterState,
): string {
  const params = new URLSearchParams({ reportKey, format });
  if (descriptor.timeFiltered) {
    if (state.dateFrom) params.set("dateFrom", state.dateFrom);
    if (state.dateTo) params.set("dateTo", state.dateTo);
  }
  if (descriptor.filters.site && state.siteId) params.set("siteId", state.siteId);
  if (descriptor.filters.vehicle && state.vehicleId) params.set("vehicleId", state.vehicleId);
  if (descriptor.filters.tank && state.tankId) params.set("tankId", state.tankId);
  return `/api/reports/export?${params.toString()}`;
}

const LINK_CLASS =
  "inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-slate-50";

export function ExportButtons({
  reportKey,
  descriptor,
  state,
  disabled,
}: {
  reportKey: ReportKey;
  descriptor: ReportDescriptor;
  state: ReportFilterState;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="flex gap-3">
        <span className={cn(LINK_CLASS, "cursor-not-allowed opacity-50")}>
          <Download className="h-4 w-4" aria-hidden="true" /> CSV
        </span>
        {descriptor.xlsx ? (
          <span className={cn(LINK_CLASS, "cursor-not-allowed opacity-50")}>
            <Download className="h-4 w-4" aria-hidden="true" /> XLSX
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <a href={buildHref(reportKey, descriptor, "csv", state)} className={LINK_CLASS} download>
        <Download className="h-4 w-4" aria-hidden="true" /> CSV
      </a>
      {descriptor.xlsx ? (
        <a href={buildHref(reportKey, descriptor, "xlsx", state)} className={LINK_CLASS} download>
          <Download className="h-4 w-4" aria-hidden="true" /> XLSX
        </a>
      ) : null}
    </div>
  );
}
