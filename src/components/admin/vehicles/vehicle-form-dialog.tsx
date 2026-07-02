"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { VehicleRow } from "@/components/admin/vehicles/vehicle-table";
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
import { api } from "@/lib/trpc/client";

export interface VehicleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create mode. */
  vehicle: VehicleRow | null;
  onSaved: () => void;
}

export function VehicleFormDialog({
  open,
  onOpenChange,
  vehicle,
  onSaved,
}: VehicleFormDialogProps) {
  const vehicleTypes = api.vehicleTypes.list.useQuery(undefined, { enabled: open });

  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleTypeId, setVehicleTypeId] = useState("");
  const [fuelType, setFuelType] = useState<"PETROL" | "DIESEL">("DIESEL");
  const [odometer, setOdometer] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPlateNumber(vehicle?.plateNumber ?? "");
      setVehicleTypeId(vehicle?.vehicleType.id ?? "");
      setFuelType(vehicle?.fuelType ?? "DIESEL");
      setOdometer(vehicle ? String(vehicle.currentOdometer) : "0");
      setIsActive(vehicle?.isActive ?? true);
      setErrorMessage(null);
    }
  }, [open, vehicle]);

  const createMutation = api.vehicles.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const updateMutation = api.vehicles.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (!vehicleTypeId) {
      setErrorMessage("Select a vehicle type.");
      return;
    }
    if (vehicle) {
      updateMutation.mutate({
        id: vehicle.id,
        plateNumber: plateNumber.trim().toUpperCase(),
        vehicleTypeId,
        fuelType,
        isActive,
      });
    } else {
      createMutation.mutate({
        plateNumber: plateNumber.trim().toUpperCase(),
        vehicleTypeId,
        fuelType,
        currentOdometer: Number(odometer) || 0,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vehicle ? `Edit ${vehicle.plateNumber}` : "Add vehicle"}</DialogTitle>
          <DialogDescription>
            {vehicle
              ? "Odometer readings only change through recorded fuel issues."
              : "The starting odometer becomes the baseline for the first fuel issue."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-plate">Plate number</Label>
            <Input
              id="vehicle-plate"
              value={plateNumber}
              onChange={(event) => setPlateNumber(event.target.value)}
              placeholder="CAB-4587"
              required
              maxLength={16}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vehicle-type">Vehicle type</Label>
            <Select value={vehicleTypeId} onValueChange={setVehicleTypeId}>
              <SelectTrigger id="vehicle-type">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {(vehicleTypes.data ?? []).map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vehicle-fuel">Fuel type</Label>
            <Select
              value={fuelType}
              onValueChange={(value) => setFuelType(value as typeof fuelType)}
            >
              <SelectTrigger id="vehicle-fuel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PETROL">Petrol</SelectItem>
                <SelectItem value="DIESEL">Diesel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {vehicle ? (
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-active">Status</Label>
              <Select
                value={isActive ? "active" : "inactive"}
                onValueChange={(value) => setIsActive(value === "active")}
              >
                <SelectTrigger id="vehicle-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="vehicle-odometer">Current odometer (km)</Label>
              <Input
                id="vehicle-odometer"
                type="number"
                min={0}
                step={1}
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
                required
              />
            </div>
          )}

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
              {isSaving ? "Saving…" : vehicle ? "Save changes" : "Add vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
