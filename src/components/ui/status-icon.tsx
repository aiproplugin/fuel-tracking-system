import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icon / Status atom: consistent colored status glyphs across tables,
 * banners, and cards.
 */
export type StatusKind = "success" | "warning" | "danger" | "info";

const STATUS_CONFIG: Record<StatusKind, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: "text-success" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  danger: { icon: XCircle, className: "text-danger" },
  info: { icon: Info, className: "text-info" },
};

export interface StatusIconProps {
  kind: StatusKind;
  className?: string;
  /** Accessible label; omit for purely decorative usage next to text. */
  label?: string;
}

export function StatusIcon({ kind, className, label }: StatusIconProps) {
  const { icon: Icon, className: colorClass } = STATUS_CONFIG[kind];
  return (
    <Icon
      className={cn("h-4 w-4 shrink-0", colorClass, className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    />
  );
}
