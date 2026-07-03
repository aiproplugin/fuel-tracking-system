import type { Metadata } from "next";
import { headers } from "next/headers";
import { DashboardClient } from "@/components/admin/dashboard/dashboard-client";
import type { SiteOption } from "@/components/admin/dashboard/dashboard-filters";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * D1_AdminDashboard. The reconciliation snapshot and site list are
 * filter-independent, so they are fetched server-side once; the KPIs, chart,
 * exception queue, and recent activity are fetched client-side by
 * DashboardClient so the range/site filters re-query live. The site select is
 * offered only to MANAGER/ADMIN — supervisors are pinned to their own site.
 */
export default async function AdminDashboardPage() {
  const session = await auth();
  const canFilterSites = session?.user.role === "MANAGER" || session?.user.role === "ADMIN";

  const caller = createCaller(
    await createTRPCContext({ headers: new Headers(Array.from(headers().entries())) }),
  );

  const [reconciliation, sites] = await Promise.all([
    caller.reconciliation.run(),
    canFilterSites ? caller.sites.list() : Promise.resolve([]),
  ]);

  const siteOptions: SiteOption[] = sites.map((site) => ({ id: site.id, name: site.name }));

  return <DashboardClient sites={siteOptions} reconciliation={reconciliation} />;
}
