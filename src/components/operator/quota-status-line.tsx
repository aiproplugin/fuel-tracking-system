"use client";

import { cn } from "@/lib/utils";
import { formatLiters, quotaPeriodNoun, type QuotaPeriodName } from "@/lib/format";

/** Matches QuotaStatusInfo from the fuel-issue service (client mirror). */
export interface QuotaLineInfo {
  state: "DISABLED" | "UNLIMITED" | "EXEMPT" | "OK" | "APPROACHING" | "EXCEEDED";
  quotaLiters: number | null;
  period: QuotaPeriodName | null;
  consumedLiters: number;
  remainingLiters: number | null;
}

/**
 * "142 L used of 300 L this week — 158 L remaining" (or "No quota" /
 * "Exempt"). Renders nothing when the master switch is off, so the flow
 * looks exactly as it did before quotas existed.
 */
export function QuotaStatusLine({ quota, className }: { quota: QuotaLineInfo; className?: string }) {
  if (quota.state === "DISABLED") return null;

  if (quota.state === "EXEMPT" || quota.state === "UNLIMITED") {
    return (
      <p className={cn("text-sm text-muted", className)}>
        Fuel quota:{" "}
        <span className="font-semibold">
          {quota.state === "EXEMPT" ? "Exempt" : "No quota"}
        </span>
      </p>
    );
  }

  const tone =
    quota.state === "EXCEEDED"
      ? "text-danger"
      : quota.state === "APPROACHING"
        ? "text-warning"
        : "text-muted";

  return (
    <p className={cn("text-sm", tone, className)}>
      <span className="font-semibold">{formatLiters(quota.consumedLiters)}</span> used of{" "}
      <span className="font-semibold">{formatLiters(quota.quotaLiters ?? 0)}</span> this{" "}
      {quota.period ? quotaPeriodNoun(quota.period) : "period"} —{" "}
      <span className="font-semibold">{formatLiters(quota.remainingLiters ?? 0)}</span> remaining
      {quota.state === "EXCEEDED" ? " (quota reached)" : ""}
      {quota.state === "APPROACHING" ? " (approaching limit)" : ""}
    </p>
  );
}
