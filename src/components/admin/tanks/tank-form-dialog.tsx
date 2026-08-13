"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { TankRow } from "@/components/admin/tanks/tank-table";
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
import { FUEL_TYPES, fuelLabel, type FuelTypeName } from "@/lib/fuel";
import { api } from "@/lib/trpc/client";

export interface TankFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tank: TankRow | null;
  onSaved: () => void;
}

export function TankFormDialog({ open, onOpenChange, tank, onSaved }: TankFormDialogProps) {
  const sites = api.sites.list.useQuery(undefined, { enabled: open && !tank });

  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [fuelType, setFuelType] = useState<FuelTypeName>("DIESEL");
  const [capacity, setCapacity] = useState("");
  const [threshold, setThreshold] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(tank?.name ?? "");
      setSiteId(tank?.site.id ?? "");
      setFuelType(tank?.fuelType ?? "DIESEL");
      setCapacity(tank ? String(tank.capacityLiters) : "");
      setThreshold(tank ? String(tank.lowStockThreshold) : "");
      setIsActive(tank?.isActive ?? true);
      setErrorMessage(null);
    }
  }, [open, tank]);

  const createMutation = api.tanks.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const updateMutation = api.tanks.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const capacityLiters = Number(capacity);
    const lowStockThreshold = Number(threshold);

    if (tank) {
      updateMutation.mutate({
        id: tank.id,
        name: name.trim(),
        capacityLiters,
        lowStockThreshold,
        isActive,
      });
    } else {
      if (!siteId) {
        setErrorMessage("Select a site.");
        return;
      }
      createMutation.mutate({
        name: name.trim(),
        siteId,
        fuelType,
        capacityLiters,
        lowStockThreshold,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tank ? `Edit ${tank.name}` : "Add tank"}</DialogTitle>
          <DialogDescription>
            {tank
              ? "Fuel type is fixed once a tank exists; stock changes only through the ledger."
              : "New tanks start at 0 L. Record a delivery (Phase 4) to add fuel."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tank-name">Name</Label>
            <Input
              id="tank-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Tank D"
              required
              maxLength={80}
            />
          </div>

          {!tank ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="tank-site">Site</Label>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger id="tank-site">
                    <SelectValue placeholder="Select a site" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sites.data ?? []).map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tank-fuel">Fuel type</Label>
                <Select
                  value={fuelType}
                  onValueChange={(value) => setFuelType(value as typeof fuelType)}
                >
                  <SelectTrigger id="tank-fuel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUEL_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {fuelLabel(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tank-capacity">Capacity (L)</Label>
              <Input
                id="tank-capacity"
                type="number"
                min={1}
                step="0.01"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tank-threshold">Low-stock threshold (L)</Label>
              <Input
                id="tank-threshold"
                type="number"
                min={1}
                step="0.01"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                required
              />
            </div>
          </div>

          {tank ? (
            <div className="space-y-1.5">
              <Label htmlFor="tank-active">Status</Label>
              <Select
                value={isActive ? "active" : "inactive"}
                onValueChange={(value) => setIsActive(value === "active")}
              >
                <SelectTrigger id="tank-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : tank ? "Save changes" : "Add tank"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
