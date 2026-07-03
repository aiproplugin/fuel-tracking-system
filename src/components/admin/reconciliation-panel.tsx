import { cn } from "@/lib/utils";
import type { TankReconciliation } from "@/server/services/reconciliation.service";

/**
 * D1 "Reconciliation status" panel: ledger-vs-cache alignment per tank.
 * Server-rendered on the dashboard from a fresh reconciliation run.
 */
export function ReconciliationPanel({
  tanks,
  matchedCount,
  totalCount,
}: {
  tanks: TankReconciliation[];
  matchedCount: number;
  totalCount: number;
}) {
  const allMatched = matchedCount === totalCount;
  return (
    <div className="rounded-[28px] border border-border bg-card p-6">
      <p className="font-bold">Reconciliation status</p>

      <div
        className={cn(
          "mt-5 rounded-2xl border p-4",
          allMatched ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
        )}
      >
        <p className={cn("text-sm", allMatched ? "text-emerald-800" : "text-red-800")}>
          Ledger and cached stock are aligned for {matchedCount} of {totalCount} tanks.
          {!allMatched ? " Run `npm run reconcile` for details." : ""}
        </p>
      </div>

      <div className="mt-4 space-y-3 text-sm">
        {tanks.map((tank) => (
          <div
            key={tank.tankId}
            className="flex justify-between rounded-2xl border border-border p-4"
          >
            <span>
              {tank.tankName}
              <span className="ml-2 text-xs text-muted">{tank.siteName}</span>
            </span>
            {tank.status === "MATCHED" ? (
              <span className="font-semibold text-success">Matched</span>
            ) : (
              <span className="font-semibold text-danger">
                {tank.chainIntact ? "Cache mismatch" : "Chain broken"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
