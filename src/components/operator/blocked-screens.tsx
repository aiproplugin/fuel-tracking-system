"use client";

import { useState, type FormEvent } from "react";
import type { LookupFound } from "@/components/operator/scan-flow";
import { QuotaStatusLine, type QuotaLineInfo } from "@/components/operator/quota-status-line";
import { Button } from "@/components/ui/button";
import { formatLiters } from "@/lib/format";
import { METER_CONFIG, formatMeter, type MeterTypeName } from "@/lib/meter";

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

/** M6_MeterBlocked — amber block; the ONLY operator action is flagging. */
export function MeterBlockedScreen({
  plateNumber,
  meterType,
  previousReading,
  attemptedReading,
  isFlagging,
  errorMessage,
  onGoBack,
  onFlag,
}: {
  plateNumber: string;
  meterType: MeterTypeName;
  previousReading: number;
  attemptedReading: number;
  isFlagging: boolean;
  errorMessage: string | null;
  onGoBack: () => void;
  onFlag: () => void;
}) {
  const meterLabel = METER_CONFIG[meterType].meterLabel.toLowerCase();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-700">Admin review required</p>
        <h1 className="mt-2 text-2xl font-extrabold text-amber-900">
          Meter reading lower than previous record
        </h1>
        <p className="mt-3 text-sm text-amber-900">
          Last recorded {meterLabel} reading is {formatMeter(previousReading, meterType)}. Only an
          administrator can authorize a corrected entry.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Attempted</span>
            <span className="font-semibold">{formatMeter(attemptedReading, meterType)}</span>
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

/** HARD_BLOCK enforcement — red block, no override path. */
export function QuotaBlockedScreen({
  plateNumber,
  quota,
  requestedLiters,
  onAdjust,
  onHome,
}: {
  plateNumber: string;
  quota: QuotaLineInfo;
  requestedLiters: number;
  onAdjust: () => void;
  onHome: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-danger">Hard block</p>
        <h1 className="mt-2 text-2xl font-extrabold text-danger">Fuel quota exceeded</h1>
        <p className="mt-3 text-sm text-red-800">
          {plateNumber} does not have enough quota left for this issue, and quota enforcement is set
          to hard block. Only {formatLiters(quota.remainingLiters ?? 0)} remain this{" "}
          {quota.period?.toLowerCase() ?? "period"}.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Requested</span>
            <span className="font-semibold">{formatLiters(requestedLiters)}</span>
          </div>
          <div className="flex justify-between">
            <span>Remaining quota</span>
            <span className="font-semibold">{formatLiters(quota.remainingLiters ?? 0)}</span>
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

/**
 * WARN_OVERRIDE enforcement — amber warning. The operator may proceed ONLY
 * with a single-use 6-digit code issued by a supervisor from the Quotas page.
 * Resubmits with the SAME idempotency key plus the code.
 */
export function QuotaWarningScreen({
  plateNumber,
  quota,
  requestedLiters,
  codeRejected,
  isSubmitting,
  onSubmitWithCode,
  onAdjust,
}: {
  plateNumber: string;
  quota: QuotaLineInfo;
  requestedLiters: number;
  codeRejected: boolean;
  isSubmitting: boolean;
  onSubmitWithCode: (code: string) => void;
  onAdjust: () => void;
}) {
  const [code, setCode] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (/^\d{6}$/.test(code)) onSubmitWithCode(code);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-700">Supervisor authorisation required</p>
        <h1 className="mt-2 text-2xl font-extrabold text-amber-900">Over fuel quota</h1>
        <p className="mt-3 text-sm text-amber-900">
          This issue takes {plateNumber} past its quota for the current{" "}
          {quota.period?.toLowerCase() ?? "period"}. A supervisor or admin can authorise it with a
          one-time override code (issued from the Quotas page). The override is audit-logged.
        </p>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Requested</span>
            <span className="font-semibold">{formatLiters(requestedLiters)}</span>
          </div>
          <div className="flex justify-between">
            <span>Remaining quota</span>
            <span className="font-semibold">{formatLiters(quota.remainingLiters ?? 0)}</span>
          </div>
        </div>
        <QuotaStatusLine quota={quota} className="mt-3 text-amber-900" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="rounded-[24px] border border-border bg-card p-4">
          <label htmlFor="override-code" className="text-sm text-muted">
            Supervisor override code
          </label>
          <input
            id="override-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            required
            className="mt-1 w-full border-none bg-transparent p-0 text-4xl font-extrabold tracking-[0.3em] text-text outline-none placeholder:text-slate-300"
          />
        </div>

        {codeRejected ? (
          <p role="alert" className="text-sm font-medium text-danger">
            That code is invalid, expired, or already used. Ask the supervisor for a new one.
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isSubmitting || !/^\d{6}$/.test(code)}
        >
          {isSubmitting ? "Submitting…" : "Proceed with authorisation"}
        </Button>
      </form>

      <div className="mt-auto">
        <Button size="lg" variant="secondary" className="w-full" onClick={onAdjust}>
          Adjust amount instead
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
          An administrator will review the meter reading. The fuel issue will be recorded once a
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
