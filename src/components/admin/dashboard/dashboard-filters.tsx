"use client";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardRange } from "@/lib/schemas/dashboard";

export interface SiteOption {
  id: string;
  name: string;
}

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "SEVEN_DAYS", label: "7 days" },
];

const ALL_SITES = "__all__";

/**
 * D1 filter bar. Range chips (Today / 7 days) plus an optional site select.
 * The site select is shown ONLY when `sites` is non-empty — supervisors are
 * pinned to their own site server-side and get no site control here.
 */
export function DashboardFilters({
  range,
  onRangeChange,
  siteId,
  onSiteChange,
  sites,
}: {
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  siteId: string | undefined;
  onSiteChange: (siteId: string | undefined) => void;
  sites: SiteOption[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-2xl border border-border bg-card p-1">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onRangeChange(option.value)}
            aria-pressed={range === option.value}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              range === option.value ? "bg-sidebar text-white" : "text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {sites.length > 0 ? (
        <div className="w-48">
          <Select
            value={siteId ?? ALL_SITES}
            onValueChange={(value) => onSiteChange(value === ALL_SITES ? undefined : value)}
          >
            <SelectTrigger className="py-2.5 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SITES}>All sites</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  );
}
