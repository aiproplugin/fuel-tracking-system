"use client";

import { useState, type FormEvent } from "react";
import type { LookupFound } from "@/components/operator/scan-flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKilometers, formatLiters } from "@/lib/format";
import { MAX_LITERS_PER_ISSUE } from "@/lib/schemas/fuel-issue";

/**
 * M5_FuelIssueForm — bound-tank context header, big numeric liters and
 * odometer entries, projection summary, single submit action. Client
 * checks are UX only; the server re-validates everything.
 */
export interface FuelIssueFormProps {
  lookup: LookupFound;
  isSubmitting: boolean;
  serverError: string | null;
  onSubmit: (liters: number, odometer: number) => void;
  onBack: () => void;
}

export function FuelIssueForm({
  lookup,
  isSubmitting,
  serverError,
  onSubmit,
  onBack,
}: FuelIssueFormProps) {
  const { vehicle, tank } = lookup;
  const [litersText, setLitersText] = useState("");
  const [odometerText, setOdometerText] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const liters = Number(litersText);
  const odometer = Number(odometerText);
  const litersValid = Number.isFinite(liters) && liters > 0 && liters <= MAX_LITERS_PER_ISSUE;
  const odometerValid = Number.isInteger(odometer) && odometer >= 0;
  const projectedStock = litersValid ? tank.currentStockLiters - liters : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientError(null);
    if (!litersValid) {
      setClientError("Enter the liters dispensed (greater than 0).");
      return;
    }
    if (!odometerValid) {
      setClientError("Enter the current odometer reading in whole kilometers.");
      return;
    }
    onSubmit(Math.round(liters * 100) / 100, odometer);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      {/* Header / TankContext — dark card from the prototype */}
      <div className="rounded-[24px] bg-sidebar p-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">Bound tank</p>
            <p className="text-lg font-bold">{tank.name}</p>
          </div>
          <Badge variant={tank.fuelType === "PETROL" ? "petrolOnDark" : "dieselOnDark"}>
            {tank.fuelType === "PETROL" ? "Petrol" : "Diesel"}
          </Badge>
        </div>
        <p className="mt-3 text-sm text-slate-300">
          Stock available · {formatLiters(tank.currentStockLiters)}
        </p>
      </div>

      <div className="rounded-[24px] border border-border bg-card p-4">
        <p className="text-sm text-muted">Vehicle</p>
        <p className="mt-1 font-bold">{vehicle.plateNumber}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
        <div className="rounded-[24px] border border-border bg-card p-4">
          <label htmlFor="issue-liters" className="text-sm text-muted">
            Liters dispensed
          </label>
          <input
            id="issue-liters"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0.1"
            max={MAX_LITERS_PER_ISSUE}
            value={litersText}
            onChange={(event) => setLitersText(event.target.value)}
            placeholder="0.0"
            required
            className="mt-1 w-full border-none bg-transparent p-0 text-4xl font-extrabold text-text outline-none placeholder:text-slate-300"
          />
        </div>

        <div className="rounded-[24px] border border-border bg-card p-4">
          <label htmlFor="issue-odometer" className="text-sm text-muted">
            Odometer (km)
          </label>
          <input
            id="issue-odometer"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            value={odometerText}
            onChange={(event) => setOdometerText(event.target.value)}
            placeholder="0"
            required
            className="mt-1 w-full border-none bg-transparent p-0 text-4xl font-extrabold text-text outline-none placeholder:text-slate-300"
          />
        </div>

        <div className="space-y-2 rounded-[24px] border border-border bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span>Previous odometer</span>
            <span className="font-semibold">{formatKilometers(vehicle.currentOdometer)}</span>
          </div>
          <div className="flex justify-between">
            <span>Projected stock after issue</span>
            <span className="font-semibold">
              {projectedStock !== null ? formatLiters(projectedStock) : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Efficiency</span>
            <span className="text-muted">
              {vehicle.lastIssueAt ? "Calculated on submit" : "Calculates after next fill"}
            </span>
          </div>
        </div>

        {clientError || serverError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {clientError ?? serverError}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-3 rounded-[24px] border border-border bg-card p-3">
          <div className="flex-1">
            <p className="text-xs text-muted">Ready to submit</p>
            <p className="font-bold">Record fuel issue</p>
          </div>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </form>

      <Button variant="ghost" onClick={onBack} disabled={isSubmitting}>
        Cancel and rescan
      </Button>
    </main>
  );
}
