"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatLiters } from "@/lib/format";
import { METER_CONFIG, formatMeter, type MeterTypeName } from "@/lib/meter";
import { api } from "@/lib/trpc/client";

export interface PendingException {
  id: string;
  plateNumber: string;
  meterType: MeterTypeName;
  tankName: string;
  operatorName: string;
  liters: number;
  previousReading: number;
  attemptedReading: number;
  createdAt: Date | string;
}

/**
 * D6_MeterExceptionReview — ADMIN approves a corrected entry (creating
 * the override-flagged transaction and its ledger movement) or rejects.
 * Reason is mandatory either way and lands in the audit trail. Labels and
 * units follow the vehicle's meter type (km / hrs / kWh).
 */
export function ExceptionReviewDialog({
  exception,
  onOpenChange,
  onReviewed,
}: {
  exception: PendingException | null;
  onOpenChange: (open: boolean) => void;
  onReviewed: () => void;
}) {
  const [correctedText, setCorrectedText] = useState("");
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (exception) {
      setCorrectedText("");
      setReason("");
      setErrorMessage(null);
    }
  }, [exception]);

  const reviewMutation = api.fuelIssues.reviewException.useMutation({
    onSuccess: onReviewed,
    onError: (error) => setErrorMessage(error.message),
  });

  const meter = exception ? METER_CONFIG[exception.meterType] : null;

  function review(decision: "APPROVE" | "REJECT") {
    if (!exception || !meter) return;
    setErrorMessage(null);
    if (reason.trim().length < 5) {
      setErrorMessage("A reason of at least 5 characters is required.");
      return;
    }
    const corrected = Number(correctedText);
    if (decision === "APPROVE" && (!Number.isInteger(corrected) || corrected < 0)) {
      setErrorMessage(`Enter the corrected reading in whole ${meter.unit}.`);
      return;
    }
    reviewMutation.mutate({
      exceptionId: exception.id,
      decision,
      ...(decision === "APPROVE" ? { correctedReading: corrected } : {}),
      reason: reason.trim(),
    });
  }

  return (
    <Dialog open={exception !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exception review</DialogTitle>
          <DialogDescription>
            Approving records the blocked fuel issue with the corrected meter reading as an audited
            override. Rejecting records the decision and writes nothing to the ledger.
          </DialogDescription>
        </DialogHeader>

        {exception && meter ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-2xl border border-border bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <span>Vehicle</span>
                <span className="font-semibold">{exception.plateNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Previous {meter.meterLabel.toLowerCase()}</span>
                <span className="font-semibold">
                  {formatMeter(exception.previousReading, exception.meterType)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Attempted</span>
                <span className="font-semibold text-danger">
                  {formatMeter(exception.attemptedReading, exception.meterType)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Liters dispensed</span>
                <span className="font-semibold">{formatLiters(exception.liters)}</span>
              </div>
              <div className="flex justify-between">
                <span>Operator</span>
                <span className="font-semibold">{exception.operatorName}</span>
              </div>
              <div className="flex justify-between">
                <span>Tank</span>
                <span className="font-semibold">{exception.tankName}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="corrected-reading">
                Corrected {meter.meterLabel.toLowerCase()} ({meter.unit})
              </Label>
              <Input
                id="corrected-reading"
                type="number"
                inputMode="numeric"
                min={exception.previousReading}
                step={1}
                value={correctedText}
                onChange={(event) => setCorrectedText(event.target.value)}
                placeholder={String(exception.previousReading)}
              />
              <p className="text-xs text-muted">
                Must be at least the vehicle&apos;s current reading. Required to approve.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="review-reason">Reason (audited)</Label>
              <Input
                id="review-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Operator entered the previous reading in error after meter photo verification."
                maxLength={500}
              />
            </div>

            {errorMessage ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => review("REJECT")}
            disabled={reviewMutation.isPending}
          >
            Reject
          </Button>
          <Button
            variant="dark"
            onClick={() => review("APPROVE")}
            disabled={reviewMutation.isPending}
          >
            {reviewMutation.isPending ? "Saving…" : "Approve corrected entry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
