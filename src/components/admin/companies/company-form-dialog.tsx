"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CompanyRow } from "@/components/admin/companies/company-table";
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

export interface CompanyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: CompanyRow | null;
  onSaved: () => void;
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: CompanyFormDialogProps) {
  const [name, setName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(company?.name ?? "");
      setErrorMessage(null);
    }
  }, [open, company]);

  const createMutation = api.companies.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const updateMutation = api.companies.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const trimmed = name.trim();

    if (company) {
      updateMutation.mutate({ id: company.id, name: trimmed });
    } else {
      createMutation.mutate({ name: trimmed });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{company ? `Edit ${company.name}` : "Add company"}</DialogTitle>
          <DialogDescription>
            Group companies own sites and vehicles. A company name must be unique.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Multilac"
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
              {isSaving ? "Saving…" : company ? "Save changes" : "Add company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
