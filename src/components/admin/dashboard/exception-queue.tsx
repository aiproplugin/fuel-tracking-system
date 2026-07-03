import Link from "next/link";
import { StatusIcon, type StatusKind } from "@/components/ui/status-icon";
import type { ExceptionKind, ExceptionQueueItem } from "@/server/services/dashboard.service";

/**
 * D1 "Exception queue" — the alert panel. Aggregates pending odometer
 * exceptions, low-stock tanks, and abnormal-consumption flags. Odometer rows
 * deep-link to the review screen (D6); the other kinds are informational.
 */
const KIND_META: Record<
  ExceptionKind,
  { label: string; tone: StatusKind; badgeClass: string; href?: string }
> = {
  ODOMETER: {
    label: "Odometer",
    tone: "danger",
    badgeClass: "text-danger",
    href: "/admin/fuel-issues",
  },
  LOW_STOCK: { label: "Low stock", tone: "warning", badgeClass: "text-warning", href: "/admin/tanks" },
  EFFICIENCY: { label: "Efficiency", tone: "info", badgeClass: "text-info" },
};

export function ExceptionQueue({ items }: { items: ExceptionQueueItem[] }) {
  return (
    <div className="rounded-[28px] border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <p className="font-bold">Exception queue</p>
        <span className="text-sm text-danger">{items.length > 0 ? "Needs review" : "All clear"}</span>
      </div>

      <div className="mt-5 space-y-3 text-sm">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-border p-4 text-muted">
            No exceptions or alerts right now.
          </div>
        ) : (
          items.map((item) => {
            const meta = KIND_META[item.kind];
            const row = (
              <div className="rounded-2xl border border-border p-4 transition-colors hover:bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-semibold">
                    <StatusIcon kind={meta.tone} />
                    {item.title}
                  </span>
                  <span className={`font-semibold ${meta.badgeClass}`}>{meta.label}</span>
                </div>
                <p className="mt-2 text-muted">{item.detail}</p>
              </div>
            );
            return meta.href ? (
              <Link key={item.id} href={meta.href} className="block">
                {row}
              </Link>
            ) : (
              <div key={item.id}>{row}</div>
            );
          })
        )}
      </div>
    </div>
  );
}
