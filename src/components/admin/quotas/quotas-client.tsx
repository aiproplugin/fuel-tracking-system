"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QuotaManageTab } from "@/components/admin/quotas/quota-manage-tab";
import { QuotaStatusTab } from "@/components/admin/quotas/quota-status-tab";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { cn } from "@/lib/utils";

/**
 * Quotas — Status (quota.view): live per-vehicle and per-company quota
 * position; Manage (quota.manage): company/type defaults, per-vehicle settings
 * and bulk assignment. Tab visibility mirrors the server-side permission gates.
 */
export function QuotasClient() {
  // Tab and control visibility mirror the server-side PERMISSION gates, not
  // roles: quota.manage unlocks configuration, quota.override.authorise unlocks
  // issuing an override code, and report.view.all unlocks the site filter
  // (matching effectiveSiteId). Each is independently enforced server-side.
  const { can } = usePermissions();
  const canManage = can("quota.manage");
  const [tab, setTab] = useState<"status" | "manage">("status");
  const activeTab = tab === "manage" && !canManage ? "status" : tab;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fuel quotas"
        title="Quotas"
        description="Per-vehicle fuel limits resolved most-specific-wins: individual → company → vehicle type → global default. Consumption is measured from the ledger inside each vehicle's own period window."
      />

      {canManage ? (
        <div className="flex gap-2" role="tablist" aria-label="Quota views">
          {(
            [
              { id: "status", label: "Status" },
              { id: "manage", label: "Manage" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "rounded-full px-5 py-2.5 text-sm font-semibold transition-colors",
                activeTab === item.id
                  ? "bg-primary text-white"
                  : "bg-card text-muted hover:text-text",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeTab === "manage" && canManage ? (
        <QuotaManageTab />
      ) : (
        <QuotaStatusTab
          canManage={canManage}
          canAuthoriseOverride={can("quota.override.authorise")}
          canFilterSite={can("report.view.all")}
        />
      )}
    </div>
  );
}
