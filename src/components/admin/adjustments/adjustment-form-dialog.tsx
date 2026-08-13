"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLiters } from "@/lib/format";
import { fuelLabel } from "@/lib/fuel";
import { api } from "@/lib/trpc/client";

export interface AdjustmentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function AdjustmentFormDialog({ open, onOpenChange, onSaved }: AdjustmentFormDialogProps) {
  const tanks = api.tanks.list.useQuery(undefined, { enabled: open });

  const [tankId, setTankId] = useState("");
  const [direction, setDirection] = useState<"decrease" | "increase">("decrease");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTankId("");
      setDirection("decrease");
      setQuantity("");
      setReason("");
      setIdempotencyKey(crypto.randomUUID());
      setMessage(null);
    }
  }, [open]);

  const createMutation = api.adjustments.create.useMutation({
    onSuccess: (result) => {
      if (result.outcome === "INSUFFICIENT_STOCK") {
        setMessage(
          `Cannot remove ${formatLiters(Math.abs(result.requestedChange))} — recorded stock is ${formatLiters(result.currentStockLiters)}.`,
        );
        return;
      }
      if (result.outcome === "OVER_CAPACITY") {
        setMessage(
          `Cannot add ${formatLiters(result.requestedChange)} — tank holds ${formatLiters(result.currentStockLiters)} of ${formatLiters(result.capacityLiters)}.`,
        );
        return;
      }
      onSaved();
    },
    onError: (error) => setMessage(error.message),
  });

  const activeTanks = (tanks.data ?? []).filter((tank) => tank.isActive);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!tankId) {
      setMessage("Select a tank.");
      return;
    }
    const magnitude = Number(quantity);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
      setMessage("Enter a positive quantity.");
      return;
    }
    createMutation.mutate({
      tankId,
      idempotencyKey,
      quantityChange: direction === "decrease" ? -magnitude : magnitude,
      reason: reason.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record adjustment</DialogTitle>
          <DialogDescription>
            For physical-count corrections (shrinkage, spillage, metering error). The reason is
            audited and shown in the register.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="adjustment-tank">Tank</Label>
            <Select value={tankId} onValueChange={setTankId}>
              <SelectTrigger id="adjustment-tank">
                <SelectValue placeholder="Select a tank" />
              </SelectTrigger>
              <SelectContent>
                {activeTanks.map((tank) => (
                  <SelectItem key={tank.id} value={tank.id}>
                    {tank.name} · {fuelLabel(tank.fuelType)} ·{" "}
                    {formatLiters(tank.currentStockLiters)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-direction">Direction</Label>
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as typeof direction)}
              >
                <SelectTrigger id="adjustment-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="decrease">Decrease (−)</SelectItem>
                  <SelectItem value="increase">Increase (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjustment-quantity">Liters</Label>
              <Input
                id="adjustment-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adjustment-reason">Reason (audited)</Label>
            <Input
              id="adjustment-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Physical dip reading 25 L below ledger after spillage on 02 Jul"
              required
              minLength={5}
              maxLength={500}
            />
          </div>

          {message ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Recording…" : "Record adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
