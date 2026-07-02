"use client";

import { useEffect, useState } from "react";
import type { UserRow } from "@/components/admin/users/user-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/trpc/client";

const NO_TANK = "none";

export interface AssignTankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  onSaved: () => void;
}

/**
 * ADMIN-only operator↔tank binding (the tank-binding rule). The operator
 * never selects a tank themselves; the change lands on their next login.
 */
export function AssignTankDialog({ open, onOpenChange, user, onSaved }: AssignTankDialogProps) {
  const tanks = api.tanks.list.useQuery(undefined, { enabled: open });
  const [tankId, setTankId] = useState<string>(NO_TANK);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTankId(user?.defaultTank?.id ?? NO_TANK);
      setErrorMessage(null);
    }
  }, [open, user]);

  const assignMutation = api.users.assignTank.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });

  const activeTanks = (tanks.data ?? []).filter((tank) => tank.isActive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign tank</DialogTitle>
          <DialogDescription>
            {user ? `${user.displayName} will be bound to this tank at their next sign-in.` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="assign-tank">Tank</Label>
            <Select value={tankId} onValueChange={setTankId}>
              <SelectTrigger id="assign-tank">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TANK}>No tank (unassigned)</SelectItem>
                {activeTanks.map((tank) => (
                  <SelectItem key={tank.id} value={tank.id}>
                    {tank.name} · {tank.fuelType === "PETROL" ? "Petrol" : "Diesel"} ·{" "}
                    {tank.site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {user?.defaultTank ? (
            <p className="text-sm text-muted">
              Currently assigned:{" "}
              <Badge variant={user.defaultTank.fuelType === "PETROL" ? "petrol" : "diesel"}>
                {user.defaultTank.name}
              </Badge>
            </p>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={assignMutation.isPending || !user}
            onClick={() => {
              if (user) {
                assignMutation.mutate({
                  userId: user.id,
                  tankId: tankId === NO_TANK ? null : tankId,
                });
              }
            }}
          >
            {assignMutation.isPending ? "Saving…" : "Save assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
