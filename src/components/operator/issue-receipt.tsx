"use client";

import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatKilometers, formatLiters } from "@/lib/format";

/**
 * Success receipt (implied screen, prototype design language): the ledger
 * confirmation the operator sees after a recorded issue.
 */
export interface IssueReceiptData {
  transactionId: string;
  plateNumber: string;
  liters: number;
  odometer: number;
  kmPerLiter: number | null;
  isAbnormal: boolean;
  tankName: string;
  balanceAfterLiters: number;
  issuedAt: Date | string;
}

export function IssueReceipt({
  receipt,
  onDone,
}: {
  receipt: IssueReceiptData;
  onDone: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-5 py-6">
      <div className="rounded-[24px] border border-border bg-card p-6 text-center shadow-panel">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-extrabold">Fuel issue recorded</h1>
        <p className="mt-1 text-sm text-muted">{formatDateTime(receipt.issuedAt)}</p>

        <p className="mt-6 text-sm text-muted">Liters dispensed</p>
        <p className="text-5xl font-extrabold">{receipt.liters.toLocaleString("en-US")}</p>
        <p className="mt-1 text-lg font-bold">{receipt.plateNumber}</p>
      </div>

      <div className="space-y-2 rounded-[24px] border border-border bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <span>Odometer recorded</span>
          <span className="font-semibold">{formatKilometers(receipt.odometer)}</span>
        </div>
        <div className="flex justify-between">
          <span>Tank</span>
          <span className="font-semibold">{receipt.tankName}</span>
        </div>
        <div className="flex justify-between">
          <span>Stock after issue</span>
          <span className="font-semibold">{formatLiters(receipt.balanceAfterLiters)}</span>
        </div>
        <div className="flex justify-between">
          <span>Efficiency</span>
          <span className="font-semibold">
            {receipt.kmPerLiter !== null
              ? `${receipt.kmPerLiter.toFixed(2)} km/L`
              : "Calculates after next fill"}
          </span>
        </div>
      </div>

      {receipt.isAbnormal ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4 text-sm">
          <Badge variant="warning">Abnormal consumption</Badge>
          <p className="mt-2 text-amber-900">
            This efficiency is outside the expected band for the vehicle type and has been flagged
            for review. The issue is still recorded.
          </p>
        </div>
      ) : null}

      <div className="mt-auto">
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </main>
  );
}
