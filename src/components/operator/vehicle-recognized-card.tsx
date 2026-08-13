"use client";

import type { LookupFound } from "@/components/operator/scan-flow";
import { QuotaStatusLine } from "@/components/operator/quota-status-line";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatLiters } from "@/lib/format";
import { fuelLabel } from "@/lib/fuel";
import { METER_CONFIG, formatMeter } from "@/lib/meter";

/**
 * M4_VehicleRecognized — plate revealed after a successful lookup, with the
 * eligibility check against the operator's bound tank. This component only
 * renders for matching fuel; mismatches go straight to the M7 screen.
 */
export interface VehicleRecognizedCardProps {
  lookup: LookupFound;
  onContinue: () => void;
  onScanAgain: () => void;
}

export function VehicleRecognizedCard({
  lookup,
  onContinue,
  onScanAgain,
}: VehicleRecognizedCardProps) {
  const { vehicle, tank } = lookup;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Vehicle recognized</span>
        <Badge variant="success">Eligible</Badge>
      </div>

      <div className="rounded-[24px] border border-border bg-card p-5">
        <p className="text-sm text-muted">Plate number · Company</p>
        <h1 className="mt-1 text-3xl font-extrabold">
          {vehicle.plateNumber}
          <span className="font-semibold text-muted"> · {vehicle.companyName}</span>
        </h1>
        <QuotaStatusLine quota={lookup.quota} className="mt-2" />
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted">Vehicle type</p>
            <p className="mt-1 font-semibold">{vehicle.vehicleTypeName}</p>
          </div>
          <div>
            <p className="text-muted">Fuel type</p>
            <p className="mt-1 font-semibold">{fuelLabel(vehicle.fuelType)}</p>
          </div>
          <div>
            <p className="text-muted">
              Last {METER_CONFIG[vehicle.meterType].meterLabel.toLowerCase()}
            </p>
            <p className="mt-1 font-semibold">
              {formatMeter(vehicle.currentMeter, vehicle.meterType)}
            </p>
          </div>
          <div>
            <p className="text-muted">Last issue</p>
            <p className="mt-1 font-semibold">
              {vehicle.lastIssueAt ? formatDateTime(vehicle.lastIssueAt) : "First fill"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-border bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <span>Assigned tank</span>
          <span className="font-semibold">
            {tank.name} · {fuelLabel(tank.fuelType)}
          </span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Stock available</span>
          <span className="font-semibold">{formatLiters(tank.currentStockLiters)}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span>Vehicle eligibility</span>
          <span className="font-semibold text-success">Fuel type matches</span>
        </div>
      </div>

      <div className="mt-auto space-y-3">
        <Button size="lg" className="w-full" onClick={onContinue}>
          Continue
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={onScanAgain}>
          Scan again
        </Button>
      </div>
    </main>
  );
}
