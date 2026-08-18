import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/admin/dashboard/dashboard-client";
import type { SiteOption } from "@/components/admin/dashboard/dashboard-filters";
import { auth } from "@/server/auth";
import { createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { buildActor } from "@/server/services/permission.service";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * D1_AdminDashboard. The reconciliation snapshot and site list are
 * filter-independent, so they are fetched server-side once; the KPIs, chart,
 * exception queue, and recent activity are fetched client-side by
 * DashboardClient so the range/site filters re-query live. The site select is
 * offered on report.view.all — mirroring effectiveSiteId(), which is what
 * actually decides scope server-side. An actor limited to their own site is
 * pinned to it regardless of what the client asks for.
 */
export default async function AdminDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const actor = await buildActor(db, {
    id: session.user.id,
    role: session.user.role,
    siteId: session.user.siteId ?? null,
    defaultTankId: session.user.defaultTankId ?? null,
  });
  const canFilterSites = actor.permissions.has("report.view.all");

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
