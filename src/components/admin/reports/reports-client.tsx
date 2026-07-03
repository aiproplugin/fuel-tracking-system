"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import {
  ReportFilters,
  type ReportFilterState,
} from "@/components/admin/reports/report-filters";
import { ExportButtons } from "@/components/admin/reports/export-buttons";
import { ReportTable } from "@/components/admin/reports/report-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/trpc/client";
import type { ReportKey } from "@/lib/schemas/reports";
import type { ReportRow } from "@/server/services/reports/report-types";

const EMPTY_FILTERS: ReportFilterState = {
  dateFrom: "",
  dateTo: "",
  siteId: undefined,
  vehicleId: undefined,
  tankId: undefined,
};

/**
 * Reports workspace. Picks a report, applies the supported filters, shows the
 * on-screen result, and offers CSV/XLSX exports of the SAME scoped data. All
 * scoping and the driver-report gate are server-side; this component only
 * chooses filters and renders what the service returns.
 */
export function ReportsClient() {
  const me = api.auth.me.useQuery();
  const canSeeSiteFilter = me.data?.role === "MANAGER" || me.data?.role === "ADMIN";

  const available = api.reports.available.useQuery();
  const sites = api.sites.list.useQuery(undefined, { enabled: canSeeSiteFilter });
  const vehicles = api.vehicles.list.useQuery();
  const tanks = api.tanks.list.useQuery();

  const [selectedKey, setSelectedKey] = useState<ReportKey | null>(null);
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);

  const descriptors = available.data ?? [];
  const activeKey = selectedKey ?? descriptors[0]?.key ?? null;
  const descriptor = descriptors.find((item) => item.key === activeKey) ?? null;

  const report = api.reports.run.useQuery(
    {
      reportKey: (activeKey ?? "vehicle-usage") as ReportKey,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      siteId: canSeeSiteFilter ? filters.siteId : undefined,
      vehicleId: filters.vehicleId,
      tankId: filters.tankId,
    },
    { enabled: !!descriptor, placeholderData: (previous) => previous },
  );

  const getRowHref = useMemo(() => {
    if (activeKey !== "vehicle-efficiency") return undefined;
    return (row: ReportRow) =>
      typeof row._vehicleId === "string" ? `/admin/reports/vehicle/${row._vehicleId}` : null;
  }, [activeKey]);

  const data = report.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Reports & export"
        description="Ledger-derived reports. On-screen figures and CSV/XLSX exports read the same source and apply the same site scoping."
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full max-w-md space-y-1.5">
          <p className="text-sm font-semibold">Report</p>
          <Select
            value={activeKey ?? undefined}
            onValueChange={(value) => {
              setSelectedKey(value as ReportKey);
              setFilters(EMPTY_FILTERS);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a report" />
            </SelectTrigger>
            <SelectContent>
              {descriptors.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {descriptor ? <p className="text-sm text-muted">{descriptor.description}</p> : null}
        </div>

        {descriptor ? (
          <ExportButtons
            reportKey={descriptor.key}
            descriptor={descriptor}
            state={filters}
            disabled={report.isLoading || (data?.rows.length ?? 0) === 0}
          />
        ) : null}
      </div>

      {descriptor ? (
        <ReportFilters
          descriptor={descriptor}
          state={filters}
          onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          sites={canSeeSiteFilter ? (sites.data ?? []) : []}
          vehicles={vehicles.data ?? []}
          tanks={tanks.data ?? []}
        />
      ) : null}

      {data ? (
        <>
          {data.summary.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {data.summary.map((item) => (
                <div key={item.label} className="rounded-2xl border border-border bg-card px-5 py-3">
                  <p className="text-xs text-muted">{item.label}</p>
                  <p className="mt-1 text-xl font-extrabold">{item.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          <ReportTable columns={data.columns} rows={data.rows} getRowHref={getRowHref} />

          {data.truncated ? (
            <p className="text-sm text-warning">
              Showing the first {data.rows.length.toLocaleString("en-US")} of{" "}
              {data.totalRows.toLocaleString("en-US")} rows. Export for the full set.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">
          {report.isLoading ? "Loading report…" : "Select a report to begin."}
        </p>
      )}
    </div>
  );
}
