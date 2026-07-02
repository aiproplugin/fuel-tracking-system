import type { Metadata } from "next";
import { headers } from "next/headers";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatLiters } from "@/lib/format";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * D1_AdminDashboard — Phase 2 scope: live stock KPIs from the ledger-backed
 * tank cache. Charts, exception queue, and recent transactions arrive with
 * their data in Phases 3–5.
 */
export default async function AdminDashboardPage() {
  const caller = createCaller(
    await createTRPCContext({ headers: new Headers(Array.from(headers().entries())) }),
  );
  const summary = await caller.tanks.stockSummary();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Overview" title="Operations dashboard" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Petrol stock" value={formatLiters(summary.petrolStockLiters)} />
        <KpiCard label="Diesel stock" value={formatLiters(summary.dieselStockLiters)} />
        <KpiCard
          label="Low-stock tanks"
          value={String(summary.lowStockTanks)}
          tone={summary.lowStockTanks > 0 ? "warning" : "default"}
        />
        <KpiCard label="Active tanks" value={String(summary.tankCount)} />
      </div>

      <Card>
        <CardContent>
          <p className="font-bold">More arriving with their data</p>
          <p className="mt-2 text-sm text-muted">
            Daily-liters chart, exception queue, recent ledger transactions, and reconciliation
            status appear here as Phases 3–5 land. Stock figures above are live — cached from the
            append-only stock ledger.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
