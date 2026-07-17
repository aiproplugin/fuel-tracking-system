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
import { formatEffectiveQuota } from "@/lib/format";
import { METER_CONFIG } from "@/lib/meter";
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
  const companies = api.companies.list.useQuery(undefined, { enabled: open });
  const noCompanies = companies.data !== undefined && companies.data.length === 0;
  // Read-only effective-quota display; the Inherit/Custom/Exempt control
  // lives on the Quotas page (Manage tab).
  const quotaDetail = api.quotas.resolveVehicle.useQuery(
    { vehicleId: vehicle?.id ?? "" },
    { enabled: open && vehicle !== null },
  );

  const [plateNumber, setPlateNumber] = useState("");
  const [vehicleTypeId, setVehicleTypeId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [fuelType, setFuelType] = useState<"PETROL" | "DIESEL">("DIESEL");
  const [meterReading, setMeterReading] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPlateNumber(vehicle?.plateNumber ?? "");
      setVehicleTypeId(vehicle?.vehicleType.id ?? "");
      setCompanyId(vehicle?.company.id ?? "");
      setFuelType(vehicle?.fuelType ?? "DIESEL");
      setMeterReading(vehicle ? String(vehicle.currentMeter) : "0");
      setIsActive(vehicle?.isActive ?? true);
      setErrorMessage(null);
    }
  }, [open, vehicle]);

  // The selected type's meter drives the reading label/unit (km / hrs / kWh).
  const selectedType = (vehicleTypes.data ?? []).find((type) => type.id === vehicleTypeId);
  const selectedMeter = selectedType ? METER_CONFIG[selectedType.meterType] : null;

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
    if (!companyId) {
      setErrorMessage("Select the owning company.");
      return;
    }
    if (vehicle) {
      updateMutation.mutate({
        id: vehicle.id,
        plateNumber: plateNumber.trim().toUpperCase(),
        vehicleTypeId,
        companyId,
        fuelType,
        isActive,
      });
    } else {
      createMutation.mutate({
        plateNumber: plateNumber.trim().toUpperCase(),
        vehicleTypeId,
        companyId,
        fuelType,
        currentMeter: Number(meterReading) || 0,
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
              ? "Meter readings only change through recorded fuel issues."
              : "The starting meter reading becomes the baseline for the first fuel issue."}
          </DialogDescription>
        </DialogHeader>

        {noCompanies ? (
          <p
            role="alert"
            className="rounded-2xl bg-warning/10 px-4 py-3 text-sm font-medium text-text"
          >
            Every vehicle belongs to a company, and none exist yet. Create a company on the
            Companies page first.
          </p>
        ) : null}

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
            <Label htmlFor="vehicle-company">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId} disabled={noCompanies}>
              <SelectTrigger id="vehicle-company">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    {type.name} · {METER_CONFIG[type.meterType].unit}
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
              <Label htmlFor="vehicle-meter">
                {selectedMeter
                  ? `Current ${selectedMeter.meterLabel.toLowerCase()} (${selectedMeter.unit})`
                  : "Current meter reading"}
              </Label>
              <Input
                id="vehicle-meter"
                type="number"
                min={0}
                step={1}
                value={meterReading}
                onChange={(event) => setMeterReading(event.target.value)}
                required
              />
            </div>
          )}

          {vehicle && quotaDetail.data ? (
            <p className="rounded-2xl bg-bg px-4 py-3 text-sm text-muted">
              Effective quota:{" "}
              <span className="font-semibold text-text">
                {formatEffectiveQuota(quotaDetail.data.usage)}
              </span>{" "}
              — manage it on the Quotas page.
            </p>
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
            <Button type="submit" disabled={isSaving || noCompanies}>
              {isSaving ? "Saving…" : vehicle ? "Save changes" : "Add vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
