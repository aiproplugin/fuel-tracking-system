"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReportDescriptor } from "@/server/services/reports/report-registry";

export interface ReportFilterState {
  dateFrom: string;
  dateTo: string;
  siteId: string | undefined;
  vehicleId: string | undefined;
  tankId: string | undefined;
}

const ALL = "__all__";

/**
 * Filter bar for the active report. Only the filters the report supports are
 * shown (from its descriptor). The site select is passed empty for supervisors
 * (they are pinned server-side) so it never renders for them.
 */
export function ReportFilters({
  descriptor,
  state,
  onChange,
  sites,
  vehicles,
  tanks,
}: {
  descriptor: ReportDescriptor;
  state: ReportFilterState;
  onChange: (patch: Partial<ReportFilterState>) => void;
  sites: { id: string; name: string }[];
  vehicles: { id: string; plateNumber: string }[];
  tanks: { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4">
      {descriptor.timeFiltered ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="report-from">From</Label>
            <Input
              id="report-from"
              type="date"
              value={state.dateFrom}
              max={state.dateTo || undefined}
              onChange={(event) => onChange({ dateFrom: event.target.value })}
              className="w-44"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">To</Label>
            <Input
              id="report-to"
              type="date"
              value={state.dateTo}
              min={state.dateFrom || undefined}
              onChange={(event) => onChange({ dateTo: event.target.value })}
              className="w-44"
            />
          </div>
        </>
      ) : null}

      {descriptor.filters.site && sites.length > 0 ? (
        <FilterSelect
          label="Site"
          placeholder="All sites"
          value={state.siteId}
          options={sites.map((site) => ({ value: site.id, label: site.name }))}
          onChange={(value) => onChange({ siteId: value })}
        />
      ) : null}

      {descriptor.filters.vehicle ? (
        <FilterSelect
          label="Vehicle"
          placeholder="All vehicles"
          value={state.vehicleId}
          options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicle.plateNumber }))}
          onChange={(value) => onChange({ vehicleId: value })}
        />
      ) : null}

      {descriptor.filters.tank ? (
        <FilterSelect
          label="Tank"
          placeholder="All tanks"
          value={state.tankId}
          options={tanks.map((tank) => ({ value: tank.id, label: tank.name }))}
          onChange={(value) => onChange({ tankId: value })}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="w-52">
        <Select
          value={value ?? ALL}
          onValueChange={(next) => onChange(next === ALL ? undefined : next)}
        >
          <SelectTrigger className="py-2.5 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{placeholder}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
