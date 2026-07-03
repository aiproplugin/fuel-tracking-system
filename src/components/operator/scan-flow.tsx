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
  MismatchScreen,
  OdometerBlockedScreen,
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

type FlowState =
  | { step: "scan" }
  | { step: "recognized"; lookup: LookupFound }
  | { step: "form"; lookup: LookupFound; idempotencyKey: string }
  | { step: "receipt"; receipt: Receipt }
  | { step: "mismatch"; lookup: LookupFound }
  | {
      step: "odometerBlocked";
      lookup: LookupFound;
      attemptedOdometer: number;
      previousOdometer: number;
      liters: number;
    }
  | { step: "insufficient"; lookup: LookupFound; availableLiters: number; requestedLiters: number }
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
      if (state.step !== "form") return;
      const lookup = state.lookup;
      switch (result.outcome) {
        case "SUCCESS":
          setState({ step: "receipt", receipt: result.receipt });
          break;
        case "FUEL_TYPE_MISMATCH":
          setState({ step: "mismatch", lookup });
          break;
        case "ODOMETER_BLOCKED":
          setState({
            step: "odometerBlocked",
            lookup,
            attemptedOdometer: result.attemptedOdometer,
            previousOdometer: result.previousOdometer,
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
          onSubmit={(liters, odometer) =>
            submitMutation.mutate({
              vehicleId: state.lookup.vehicle.id,
              idempotencyKey: state.idempotencyKey,
              liters,
              odometer,
            })
          }
        />
      );

    case "receipt":
      return <IssueReceipt receipt={state.receipt} onDone={() => router.push("/home")} />;

    case "mismatch":
      return <MismatchScreen lookup={state.lookup} onScanAgain={backToScan} />;

    case "odometerBlocked":
      return (
        <OdometerBlockedScreen
          plateNumber={state.lookup.vehicle.plateNumber}
          previousOdometer={state.previousOdometer}
          attemptedOdometer={state.attemptedOdometer}
          isFlagging={flagMutation.isPending}
          errorMessage={submitError}
          onGoBack={() => openForm(state.lookup)}
          onFlag={() =>
            flagMutation.mutate({
              vehicleId: state.lookup.vehicle.id,
              attemptedOdometer: state.attemptedOdometer,
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

    case "flagged":
      return <FlaggedConfirmation onDone={() => router.push("/home")} />;
  }
}
