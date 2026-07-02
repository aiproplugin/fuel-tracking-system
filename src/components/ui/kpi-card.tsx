import { cn } from "@/lib/utils";

/**
 * Card / KPI molecule from the prototype dashboard: muted label on top,
 * large extrabold value, optional tone for alert values.
 */
export type KpiTone = "default" | "warning" | "danger" | "info" | "success";

const TONE_CLASS: Record<KpiTone, string> = {
  default: "text-text",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  success: "text-success",
};

export interface KpiCardProps {
  label: string;
  value: string;
  tone?: KpiTone;
  hint?: string;
  className?: string;
}

export function KpiCard({ label, value, tone = "default", hint, className }: KpiCardProps) {
  return (
    <div className={cn("rounded-[24px] border border-border bg-card p-5", className)}>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-2 text-3xl font-extrabold", TONE_CLASS[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
