"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { FuelIssueForm } from "@/components/operator/fuel-issue-form";
import { IssueReceipt } from "@/components/operator/issue-receipt";
import {
  FlaggedConfirmation,
  InsufficientStockScreen,
  MeterBlockedScreen,
  MismatchScreen,
  QuotaBlockedScreen,
  QuotaWarningScreen,
} from "@/components/operator/blocked-screens";
import { QrScanner } from "@/components/operator/qr-scanner";
import { VehicleRecognizedCard } from "@/components/operator/vehicle-recognized-card";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/api/root";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LookupResult = RouterOutputs["fuelIssues"]["lookupVehicle"];
export type LookupFound = Extract<LookupResult, { found: true }>;
type SubmitResult = RouterOutputs["fuelIssues"]["submit"];
type Receipt = Extract<SubmitResult, { outcome: "SUCCESS" }>["receipt"];
type QuotaInfo = Extract<SubmitResult, { outcome: "QUOTA_EXCEEDED" }>["quota"];

type FlowState =
  | { step: "scan" }
  | { step: "recognized"; lookup: LookupFound }
  | { step: "form"; lookup: LookupFound; idempotencyKey: string }
  | { step: "receipt"; receipt: Receipt }
  | { step: "mismatch"; lookup: LookupFound }
  | {
      step: "meterBlocked";
      lookup: LookupFound;
      attemptedReading: number;
      previousReading: number;
      liters: number;
    }
  | { step: "insufficient"; lookup: LookupFound; availableLiters: number; requestedLiters: number }
  | { step: "quotaBlocked"; lookup: LookupFound; quota: QuotaInfo; requestedLiters: number }
  // Retains the same idempotency key + entry values so the code resubmission
  // is the SAME logical submission, just now authorised.
  | {
      step: "quotaExceeded";
      lookup: LookupFound;
      idempotencyKey: string;
      liters: number;
      meterReading: number;
      quota: QuotaInfo;
      codeRejected: boolean;
    }
  | { step: "flagged" };

/**
 * The M3→M7 fuel-issue state machine. Every business rule is re-validated
 * server-side; this component only maps typed outcomes to the prototype
 * screens. The idempotency key is minted when the form opens and reused
 * for every retry of that submission.
 */
export function ScanFlow() {
  const router = useRouter();
  const [state, setState] = useState<FlowState>({ step: "scan" });
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const lookupMutation = api.fuelIssues.lookupVehicle.useMutation({
    onSuccess: (result) => {
      if (!result.found) {
        setLookupError("Vehicle not recognized. Check the code and try again.");
        return;
      }
      setLookupError(null);
      setState(
        result.fuelMatches
          ? { step: "recognized", lookup: result }
          : { step: "mismatch", lookup: result },
      );
    },
    onError: (error) => {
      setLookupError(
        error.data?.code === "TOO_MANY_REQUESTS" ? error.message : "Lookup failed. Try again.",
      );
    },
  });

  const submitMutation = api.fuelIssues.submit.useMutation({
    onSuccess: (result, variables) => {
      setSubmitError(null);
      if (state.step !== "form" && state.step !== "quotaExceeded") return;
      const lookup = state.lookup;
      switch (result.outcome) {
        case "SUCCESS":
          setState({ step: "receipt", receipt: result.receipt });
          break;
        case "FUEL_TYPE_MISMATCH":
          setState({ step: "mismatch", lookup });
          break;
        case "METER_BLOCKED":
          setState({
            step: "meterBlocked",
            lookup,
            attemptedReading: result.attemptedReading,
            previousReading: result.previousReading,
            liters: variables.liters,
          });
          break;
        case "INSUFFICIENT_STOCK":
          setState({
            step: "insufficient",
            lookup,
            availableLiters: result.availableLiters,
            requestedLiters: result.requestedLiters,
          });
          break;
        case "QUOTA_BLOCKED":
          setState({
            step: "quotaBlocked",
            lookup,
            quota: result.quota,
            requestedLiters: result.requestedLiters,
          });
          break;
        case "QUOTA_EXCEEDED":
          setState({
            step: "quotaExceeded",
            lookup,
            idempotencyKey: variables.idempotencyKey,
            liters: variables.liters,
            meterReading: variables.meterReading,
            quota: result.quota,
            codeRejected: result.codeRejected,
          });
          break;
      }
    },
    onError: (error) => setSubmitError(error.message),
  });

  const flagMutation = api.fuelIssues.flagException.useMutation({
    onSuccess: () => setState({ step: "flagged" }),
    onError: (error) => setSubmitError(error.message),
  });

  function openForm(lookup: LookupFound) {
    setSubmitError(null);
    setState({ step: "form", lookup, idempotencyKey: crypto.randomUUID() });
  }

  const backToScan = () => {
    setLookupError(null);
    setSubmitError(null);
    setState({ step: "scan" });
  };

  switch (state.step) {
    case "scan":
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-slate-950 px-5 py-6 text-white">
          <div className="flex items-center justify-between text-sm">
            <Link href="/home" className="text-slate-300 hover:text-white">
              Back
            </Link>
            <span className="text-slate-500">Fuel issue</span>
          </div>
          <QrScanner
            onToken={(token, manual) => lookupMutation.mutate({ token, manual })}
            disabled={lookupMutation.isPending}
            errorMessage={lookupError}
          />
        </main>
      );

    case "recognized":
      return (
        <VehicleRecognizedCard
          lookup={state.lookup}
          onContinue={() => openForm(state.lookup)}
          onScanAgain={backToScan}
        />
      );

    case "form":
      return (
        <FuelIssueForm
          lookup={state.lookup}
          isSubmitting={submitMutation.isPending}
          serverError={submitError}
          onBack={backToScan}
          onSubmit={(liters, meterReading) =>
            submitMutation.mutate({
              vehicleId: state.lookup.vehicle.id,
              idempotencyKey: state.idempotencyKey,
              liters,
              meterReading,
            })
          }
        />
      );

    case "receipt":
      return <IssueReceipt receipt={state.receipt} onDone={() => router.push("/home")} />;

    case "mismatch":
      return <MismatchScreen lookup={state.lookup} onScanAgain={backToScan} />;

    case "meterBlocked":
      return (
        <MeterBlockedScreen
          plateNumber={state.lookup.vehicle.plateNumber}
          meterType={state.lookup.vehicle.meterType}
          previousReading={state.previousReading}
          attemptedReading={state.attemptedReading}
          isFlagging={flagMutation.isPending}
          errorMessage={submitError}
          onGoBack={() => openForm(state.lookup)}
          onFlag={() =>
            flagMutation.mutate({
              vehicleId: state.lookup.vehicle.id,
              attemptedReading: state.attemptedReading,
              liters: state.liters,
            })
          }
        />
      );

    case "insufficient":
      return (
        <InsufficientStockScreen
          availableLiters={state.availableLiters}
          requestedLiters={state.requestedLiters}
          onAdjust={() => openForm(state.lookup)}
          onHome={() => router.push("/home")}
        />
      );

    case "quotaBlocked":
      return (
        <QuotaBlockedScreen
          plateNumber={state.lookup.vehicle.plateNumber}
          quota={state.quota}
          requestedLiters={state.requestedLiters}
          onAdjust={() => openForm(state.lookup)}
          onHome={() => router.push("/home")}
        />
      );

    case "quotaExceeded":
      return (
        <QuotaWarningScreen
          plateNumber={state.lookup.vehicle.plateNumber}
          quota={state.quota}
          requestedLiters={state.liters}
          codeRejected={state.codeRejected}
          isSubmitting={submitMutation.isPending}
          onSubmitWithCode={(code) =>
            submitMutation.mutate({
              vehicleId: state.lookup.vehicle.id,
              idempotencyKey: state.idempotencyKey,
              liters: state.liters,
              meterReading: state.meterReading,
              overrideCode: code,
            })
          }
          onAdjust={() => openForm(state.lookup)}
        />
      );

    case "flagged":
      return <FlaggedConfirmation onDone={() => router.push("/home")} />;
  }
}
