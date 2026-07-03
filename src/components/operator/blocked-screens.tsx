"use client";

import type { LookupFound } from "@/components/operator/scan-flow";
import { Button } from "@/components/ui/button";
import { formatKilometers, formatLiters } from "@/lib/format";

const fuelLabel = (fuelType: "PETROL" | "DIESEL") => (fuelType === "PETROL" ? "Petrol" : "Diesel");

/** M7_FuelTypeMismatch — red HARD BLOCK. There is no override path. */
export function MismatchScreen({
  lookup,
  onScanAgain,
}: {
  lookup: LookupFound;
  onScanAgain: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-danger">Hard block</p>
        <h1 className="mt-2 text-2xl font-extrabold text-danger">Fuel type mismatch</h1>
        <p className="mt-3 text-sm text-red-800">
          {lookup.vehicle.plateNumber} uses {fuelLabel(lookup.vehicle.fuelType)}. Your assigned tank
          ({lookup.tank.name}) dispenses {fuelLabel(lookup.tank.fuelType)}. Fuel issue cannot
          continue from this tank.
        </p>
      </div>

      <div className="mt-auto space-y-3">
        <Button size="lg" variant="secondary" className="w-full" onClick={onScanAgain}>
          Scan another vehicle
        </Button>
      </div>
    </main>
  );
}

/** M6_OdometerBlocked — amber block; the ONLY operator action is flagging. */
export function OdometerBlockedScreen({
  plateNumber,
  previousOdometer,
  attemptedOdometer,
  isFlagging,
  errorMessage,
  onGoBack,
  onFlag,
}: {
  plateNumber: string;
  previousOdometer: number;
  attemptedOdometer: number;
  isFlagging: boolean;
  errorMessage: string | null;
  onGoBack: () => void;
  onFlag: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-700">Admin review required</p>
        <h1 className="mt-2 text-2xl font-extrabold text-amber-900">
          Odometer lower than previous record
        </h1>
        <p className="mt-3 text-sm text-amber-900">
          Last recorded odometer is {formatKilometers(previousOdometer)}. Only an administrator can
          authorize a corrected entry.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Attempted</span>
            <span className="font-semibold">{formatKilometers(attemptedOdometer)}</span>
          </div>
          <div className="flex justify-between">
            <span>Vehicle</span>
            <span className="font-semibold">{plateNumber}</span>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-auto space-y-3">
        <Button size="lg" variant="secondary" className="w-full" onClick={onGoBack}>
          Go back
        </Button>
        <Button size="lg" variant="dark" className="w-full" onClick={onFlag} disabled={isFlagging}>
          {isFlagging ? "Flagging…" : "Flag for admin review"}
        </Button>
      </div>
    </main>
  );
}

/** Stock guard result — same design language as the other block screens. */
export function InsufficientStockScreen({
  availableLiters,
  requestedLiters,
  onAdjust,
  onHome,
}: {
  availableLiters: number;
  requestedLiters: number;
  onAdjust: () => void;
  onHome: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-700">Cannot record</p>
        <h1 className="mt-2 text-2xl font-extrabold text-amber-900">Not enough recorded stock</h1>
        <p className="mt-3 text-sm text-amber-900">
          The ledger shows less fuel in your tank than this issue. If the physical tank has fuel, a
          supervisor needs to record the missing delivery or an adjustment first.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Requested</span>
            <span className="font-semibold">{formatLiters(requestedLiters)}</span>
          </div>
          <div className="flex justify-between">
            <span>Recorded stock</span>
            <span className="font-semibold">{formatLiters(availableLiters)}</span>
          </div>
        </div>
      </div>

      <div className="mt-auto space-y-3">
        <Button size="lg" variant="secondary" className="w-full" onClick={onAdjust}>
          Adjust amount
        </Button>
        <Button size="lg" variant="ghost" className="w-full" onClick={onHome}>
          Back to home
        </Button>
      </div>
    </main>
  );
}

/** Post-flag confirmation. */
export function FlaggedConfirmation({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-border bg-card p-6 text-center shadow-panel">
        <h1 className="text-2xl font-extrabold">Flagged for review</h1>
        <p className="mt-3 text-sm text-muted">
          An administrator will review the odometer reading. The fuel issue will be recorded once a
          corrected entry is approved — you don&apos;t need to resubmit it.
        </p>
      </div>
      <div className="mt-auto">
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </main>
  );
}
