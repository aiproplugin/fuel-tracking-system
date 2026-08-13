import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge / FuelType and status chips from the prototype: rounded-full,
 * small semibold text, tinted backgrounds. `petrol`, `diesel`, and `kerosene`
 * are the canonical fuel-type chips; the `*OnDark` pairs are for the dark
 * slate context cards. Never pick these by hand — read them from FUEL_CONFIG
 * in src/lib/fuel.ts.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "bg-slate-100 text-text",
        petrol: "bg-petrol/10 text-petrol",
        diesel: "bg-diesel/10 text-diesel",
        kerosene: "bg-kerosene/10 text-kerosene",
        petrolOnDark: "bg-emerald-500/20 text-emerald-300",
        dieselOnDark: "bg-amber-500/20 text-amber-300",
        keroseneOnDark: "bg-blue-500/20 text-blue-300",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        danger: "bg-danger/10 text-danger",
        info: "bg-info/10 text-info",
        outline: "border border-border bg-card text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
