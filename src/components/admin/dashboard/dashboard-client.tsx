"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { ReconciliationPanel } from "@/components/admin/reconciliation-panel";
import { DailyLitersChart } from "@/components/admin/dashboard/daily-liters-chart";
import { DashboardFilters, type SiteOption } from "@/components/admin/dashboard/dashboard-filters";
import { ExceptionQueue } from "@/components/admin/dashboard/exception-queue";
import { RecentTransactions } from "@/components/admin/dashboard/recent-transactions";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatLiters } from "@/lib/format";
import { api } from "@/lib/trpc/client";
import type { DashboardRange } from "@/lib/schemas/dashboard";
import type { TankReconciliation } from "@/server/services/reconciliation.service";

/**
 * D1 Operations dashboard. Server component supplies the filter-independent
 * reconciliation snapshot and the site list; everything else is fetched
 * client-side so the range/site filters re-query live.
 */
export function DashboardClient({
  sites,
  reconciliation,
}: {
  sites: SiteOption[];
  reconciliation: { tanks: TankReconciliation[]; matchedCount: number; totalCount: number };
}) {
  const [range, setRange] = useState<DashboardRange>("SEVEN_DAYS");
  const [siteId, setSiteId] = useState<string | undefined>(undefined);

  const summary = api.dashboard.summary.useQuery(
    { range, siteId },
    { placeholderData: (previous) => previous },
  );

  const kpis = summary.data?.kpis;
  const volumeLabel = range === "TODAY" ? "Fuel issued today" : "Fuel issued (7 days)";
  const show = (value: string) => (summary.data ? value : "—");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Operations dashboard"
        actions={
          <DashboardFilters
            range={range}
            onRangeChange={setRange}
            siteId={siteId}
            onSiteChange={setSiteId}
            sites={sites}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label={volumeLabel} value={show(formatLiters(kpis?.volumeLiters ?? 0))} />
        <KpiCard label="Petrol stock" value={show(formatLiters(kpis?.petrolStockLiters ?? 0))} />
        <KpiCard label="Diesel stock" value={show(formatLiters(kpis?.dieselStockLiters ?? 0))} />
        <KpiCard
          label="Low-stock tanks"
          value={show(String(kpis?.lowStockTanks ?? 0))}
          tone={kpis && kpis.lowStockTanks > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Odometer exceptions"
          value={show(String(kpis?.odometerExceptionsPending ?? 0))}
          tone={kpis && kpis.odometerExceptionsPending > 0 ? "danger" : "default"}
        />
        <KpiCard
          label="Abnormal consumption"
          value={show(String(kpis?.abnormalConsumption ?? 0))}
          tone={kpis && kpis.abnormalConsumption > 0 ? "info" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <DailyLitersChart data={summary.data?.dailyLiters ?? []} />
        <ExceptionQueue items={summary.data?.exceptionQueue ?? []} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <RecentTransactions rows={summary.data?.recentTransactions ?? []} />
        <ReconciliationPanel
          tanks={reconciliation.tanks}
          matchedCount={reconciliation.matchedCount}
          totalCount={reconciliation.totalCount}
        />
      </div>
    </div>
  );
}
