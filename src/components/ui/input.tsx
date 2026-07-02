import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input / Text from the prototype: rounded-2xl, generous padding,
 * muted placeholder, teal focus ring.
 */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-base text-text",
        "placeholder:text-muted",
        "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
