"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { TankFormDialog } from "@/components/admin/tanks/tank-form-dialog";
import { TankTable, type TankRow } from "@/components/admin/tanks/tank-table";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";

export function TanksClient() {
  const utils = api.useUtils();
  const tanks = api.tanks.list.useQuery();
  const me = api.auth.me.useQuery();
  const isAdmin = me.data?.role === "ADMIN";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TankRow | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master data"
        title="Tanks"
        description="Stock figures are cached from the append-only ledger. New tanks start empty — fuel arrives through deliveries."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              Add tank
            </Button>
          ) : undefined
        }
      />

      <TankTable
        tanks={tanks.data ?? []}
        isLoading={tanks.isLoading}
        canEdit={isAdmin}
        onEdit={(tank) => {
          setEditing(tank);
          setDialogOpen(true);
        }}
      />

      <TankFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tank={editing}
        onSaved={() => {
          setDialogOpen(false);
          void utils.tanks.list.invalidate();
          void utils.tanks.stockSummary.invalidate();
        }}
      />
    </div>
  );
}
