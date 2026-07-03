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
import { api } from "@/lib/trpc/client";

/** datetime-local value for "now" in the browser's local time. */
function localDateTimeNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export interface DeliveryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function DeliveryFormDialog({ open, onOpenChange, onSaved }: DeliveryFormDialogProps) {
  const tanks = api.tanks.list.useQuery(undefined, { enabled: open });

  const [tankId, setTankId] = useState("");
  const [liters, setLiters] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [deliveredAt, setDeliveredAt] = useState(localDateTimeNow());
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTankId("");
      setLiters("");
      setSupplierName("");
      setReferenceNo("");
      setDeliveredAt(localDateTimeNow());
      // Minted once per form open; retries reuse it (idempotent dedupe).
      setIdempotencyKey(crypto.randomUUID());
      setMessage(null);
    }
  }, [open]);

  const createMutation = api.deliveries.create.useMutation({
    onSuccess: (result) => {
      if (result.outcome === "OVER_CAPACITY") {
        setMessage(
          `Over capacity: tank holds ${formatLiters(result.currentStockLiters)} of ${formatLiters(result.capacityLiters)} — cannot add ${formatLiters(result.requestedLiters)}.`,
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
    createMutation.mutate({
      tankId,
      idempotencyKey,
      liters: Number(liters),
      supplierName: supplierName.trim() || undefined,
      referenceNo: referenceNo.trim() || undefined,
      deliveredAt: new Date(deliveredAt),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record delivery</DialogTitle>
          <DialogDescription>
            Writes a DELIVERY movement to the ledger. Backdating is allowed up to 31 days for paper
            records catching up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="delivery-tank">Tank</Label>
            <Select value={tankId} onValueChange={setTankId}>
              <SelectTrigger id="delivery-tank">
                <SelectValue placeholder="Select a tank" />
              </SelectTrigger>
              <SelectContent>
                {activeTanks.map((tank) => (
                  <SelectItem key={tank.id} value={tank.id}>
                    {tank.name} · {tank.fuelType === "PETROL" ? "Petrol" : "Diesel"} ·{" "}
                    {formatLiters(tank.currentStockLiters)} of {formatLiters(tank.capacityLiters)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="delivery-liters">Liters received</Label>
              <Input
                id="delivery-liters"
                type="number"
                min="0.01"
                step="0.01"
                value={liters}
                onChange={(event) => setLiters(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delivery-at">Delivered at</Label>
              <Input
                id="delivery-at"
                type="datetime-local"
                value={deliveredAt}
                max={localDateTimeNow()}
                onChange={(event) => setDeliveredAt(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="delivery-supplier">Supplier (optional)</Label>
              <Input
                id="delivery-supplier"
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delivery-reference">Reference no. (optional)</Label>
              <Input
                id="delivery-reference"
                value={referenceNo}
                onChange={(event) => setReferenceNo(event.target.value)}
                maxLength={60}
              />
            </div>
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
              {createMutation.isPending ? "Recording…" : "Record delivery"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
