import { cn } from "@/lib/utils";

/**
 * Admin page header (prototype D1): small muted context line + 3xl
 * extrabold title, with an optional action slot on the right.
 */
export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        {eyebrow ? <p className="text-sm text-muted">{eyebrow}</p> : null}
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-3">{actions}</div> : null}
    </div>
  );
}
