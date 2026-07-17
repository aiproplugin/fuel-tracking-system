"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QuotaPeriodName } from "@/lib/format";

export const QUOTA_PERIOD_OPTIONS: ReadonlyArray<{ value: QuotaPeriodName; label: string }> = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

export interface QuotaPairFieldsProps {
  idPrefix: string;
  liters: string;
  period: QuotaPeriodName;
  onLitersChange: (value: string) => void;
  onPeriodChange: (value: QuotaPeriodName) => void;
  disabled?: boolean;
}

/**
 * The ONLY quota input in the UI: litres and period side by side, always
 * edited together — the pair rule made visible.
 */
export function QuotaPairFields({
  idPrefix,
  liters,
  period,
  onLitersChange,
  onPeriodChange,
  disabled,
}: QuotaPairFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-liters`}>Litres</Label>
        <Input
          id={`${idPrefix}-liters`}
          type="number"
          min={1}
          step="0.01"
          value={liters}
          onChange={(event) => onLitersChange(event.target.value)}
          disabled={disabled}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-period`}>Period</Label>
        <Select
          value={period}
          onValueChange={(value) => onPeriodChange(value as QuotaPeriodName)}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-period`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUOTA_PERIOD_OPTIONS.map((option) => (
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
