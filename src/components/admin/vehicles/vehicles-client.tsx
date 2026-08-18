"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { VehicleFormDialog } from "@/components/admin/vehicles/vehicle-form-dialog";
import { VehicleTable, type VehicleRow } from "@/components/admin/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { api } from "@/lib/trpc/client";

export function VehiclesClient() {
  const utils = api.useUtils();
  const vehicles = api.vehicles.list.useQuery();
  // Gate on the permission the server actually enforces, so a granted
  // masterdata.manage reveals these controls for any role that holds it.
  const { can } = usePermissions();
  const canManage = can("masterdata.manage");

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
        actions={canManage ? <Button onClick={openCreate}>Add vehicle</Button> : undefined}
      />

      <VehicleTable
        vehicles={vehicles.data ?? []}
        isLoading={vehicles.isLoading}
        canEdit={canManage}
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
