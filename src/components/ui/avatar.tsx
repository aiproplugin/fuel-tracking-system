import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Avatar / User atom: initials in a rounded slate tile (prototype M2).
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name, className, ...props }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-muted",
        className,
      )}
      aria-hidden="true"
      {...props}
    >
      {initialsOf(name)}
    </span>
  );
}
