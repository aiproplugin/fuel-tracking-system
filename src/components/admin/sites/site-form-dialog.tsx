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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/trpc/client";

export interface SiteFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteRow | null;
  onSaved: () => void;
}

export function SiteFormDialog({ open, onOpenChange, site, onSaved }: SiteFormDialogProps) {
  const companies = api.companies.list.useQuery(undefined, { enabled: open });
  const noCompanies = companies.data !== undefined && companies.data.length === 0;

  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(site?.name ?? "");
      setCompanyId(site?.companyId ?? "");
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
    if (!companyId) {
      setErrorMessage("Select the owning company.");
      return;
    }

    if (site) {
      updateMutation.mutate({ id: site.id, name: trimmed, companyId });
    } else {
      createMutation.mutate({ name: trimmed, companyId });
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

        {noCompanies ? (
          <p role="alert" className="rounded-2xl bg-warning/10 px-4 py-3 text-sm font-medium text-text">
            Every site belongs to a company, and none exist yet. Create a company on the
            Companies page first.
          </p>
        ) : null}

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

          <div className="space-y-1.5">
            <Label htmlFor="site-company">Company</Label>
            <Select value={companyId} onValueChange={setCompanyId} disabled={noCompanies}>
              <SelectTrigger id="site-company">
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
              {isSaving ? "Saving…" : site ? "Save changes" : "Add site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
