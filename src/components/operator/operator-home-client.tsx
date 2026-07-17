"use client";

import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { formatLiters, formatTime } from "@/lib/format";
import { METER_CONFIG } from "@/lib/meter";
import { api } from "@/lib/trpc/client";

function greetingForNow(): string {
  const colomboHour = (new Date().getUTCHours() + 5.5) % 24;
  if (colomboHour < 12) return "Good morning";
  if (colomboHour < 17) return "Good afternoon";
  return "Good evening";
}

export function OperatorHomeClient({ displayName }: { displayName: string }) {
  const day = api.fuelIssues.myDay.useQuery(undefined, { refetchInterval: 60_000 });
  const firstName = displayName.split(" ")[0] ?? displayName;
  const tank = day.data?.tank ?? null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{greetingForNow()}</p>
          <h1 className="text-2xl font-bold">{firstName}</h1>
        </div>
        <Logo size="md" />
      </div>

      {/* Assigned tank — dark context card from the prototype */}
      {day.isLoading ? (
        <div className="h-32 animate-pulse rounded-[24px] bg-slate-200" />
      ) : tank ? (
        <div className="rounded-[24px] bg-sidebar p-5 text-white">
          <p className="text-sm text-slate-300">Assigned tank</p>
          <div className="mt-2 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-bold">{tank.name}</h2>
              <Badge
                variant={tank.fuelType === "PETROL" ? "petrolOnDark" : "dieselOnDark"}
                className="mt-3"
              >
                {tank.fuelType === "PETROL" ? "Petrol" : "Diesel"}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-300">Current stock</p>
              <p className="text-3xl font-extrabold">
                {tank.currentStockLiters.toLocaleString("en-US")} L
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm font-semibold text-amber-700">No tank assigned</p>
          <p className="mt-2 text-sm text-amber-900">
            You need a tank binding before issuing fuel. Contact an administrator.
          </p>
        </div>
      )}

      {/* Primary action */}
      {tank ? (
        <Link
          href="/scan"
          className="block rounded-[24px] bg-primary p-5 text-left text-white shadow-soft transition-colors hover:bg-primary/90"
        >
          <p className="text-sm opacity-80">Primary action</p>
          <p className="mt-1 text-2xl font-bold">Scan vehicle QR</p>
        </Link>
      ) : null}

      {/* Today's stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted">Issues</p>
          <p className="mt-2 text-xl font-bold">{day.data?.todayIssueCount ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted">Liters</p>
          <p className="mt-2 text-xl font-bold">
            {day.data ? Math.round(day.data.todayLiters).toLocaleString("en-US") : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted">Alerts</p>
          <p
            className={`mt-2 text-xl font-bold ${(day.data?.todayAbnormal ?? 0) > 0 ? "text-warning" : ""}`}
          >
            {day.data?.todayAbnormal ?? "—"}
          </p>
        </div>
      </div>

      {/* Recent issues */}
      <div className="flex-1 rounded-[24px] border border-border bg-card p-4">
        <p className="font-semibold">Recent issues</p>
        <div className="mt-4 space-y-3 text-sm">
          {day.data && day.data.recent.length === 0 ? (
            <p className="text-muted">No issues recorded yet.</p>
          ) : (
            (day.data?.recent ?? []).map((issue) => (
              <div key={issue.id} className="flex items-center justify-between">
                <span className="font-medium">
                  {issue.plateNumber}
                  {issue.isAbnormal ? (
                    <Badge variant="warning" className="ml-2">
                      {METER_CONFIG[issue.meterType].efficiencyUnit}
                    </Badge>
                  ) : null}
                </span>
                <span className="text-muted">
                  {formatLiters(issue.liters)} · {formatTime(issue.issuedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <SignOutButton />
    </main>
  );
}
