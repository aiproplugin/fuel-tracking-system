"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SiteRow } from "@/components/admin/sites/site-table";
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
import { api } from "@/lib/trpc/client";

export interface SiteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteRow | null;
  onSaved: () => void;
}

export function SiteFormDialog({ open, onOpenChange, site, onSaved }: SiteFormDialogProps) {
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(site?.name ?? "");
      setErrorMessage(null);
    }
  }, [open, site]);

  const createMutation = api.sites.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const updateMutation = api.sites.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const trimmed = name.trim();

    if (site) {
      updateMutation.mutate({ id: site.id, name: trimmed });
    } else {
      createMutation.mutate({ name: trimmed });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{site ? `Edit ${site.name}` : "Add site"}</DialogTitle>
          <DialogDescription>
            Sites group tanks and users. A site name must be unique.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="site-name">Name</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main Depot"
              required
              minLength={2}
              maxLength={80}
            />
          </div>

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
              {isSaving ? "Saving…" : site ? "Save changes" : "Add site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
