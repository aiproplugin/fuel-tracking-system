"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { VehicleFormDialog } from "@/components/admin/vehicles/vehicle-form-dialog";
import { VehicleTable, type VehicleRow } from "@/components/admin/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";

export function VehiclesClient() {
  const utils = api.useUtils();
  const vehicles = api.vehicles.list.useQuery();
  const me = api.auth.me.useQuery();
  const isAdmin = me.data?.role === "ADMIN";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(vehicle: VehicleRow) {
    setEditing(vehicle);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master data"
        title="Vehicles"
        description="Fleet vehicles with their fuel type and consumption class. Meter readings only move through recorded fuel issues."
        actions={isAdmin ? <Button onClick={openCreate}>Add vehicle</Button> : undefined}
      />

      <VehicleTable
        vehicles={vehicles.data ?? []}
        isLoading={vehicles.isLoading}
        canEdit={isAdmin}
        onEdit={openEdit}
      />

      <VehicleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        vehicle={editing}
        onSaved={() => {
          setDialogOpen(false);
          void utils.vehicles.list.invalidate();
        }}
      />
    </div>
  );
}
