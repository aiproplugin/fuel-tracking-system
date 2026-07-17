"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { CompanyFormDialog } from "@/components/admin/companies/company-form-dialog";
import { CompanyTable, type CompanyRow } from "@/components/admin/companies/company-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/trpc/client";

export function CompaniesClient() {
  const utils = api.useUtils();
  const companies = api.companies.list.useQuery();
  const me = api.auth.me.useQuery();
  const isAdmin = me.data?.role === "ADMIN";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CompanyRow | null>(null);

  const [deleting, setDeleting] = useState<CompanyRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = api.companies.delete.useMutation({
    onSuccess: () => {
      setDeleting(null);
      void utils.companies.list.invalidate();
    },
    onError: (error) => setDeleteError(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master data"
        title="Companies"
        description="Group companies that own sites and vehicles. Every site and vehicle must belong to a company, so create the company first."
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              Add company
            </Button>
          ) : undefined
        }
      />

      <CompanyTable
        companies={companies.data ?? []}
        isLoading={companies.isLoading}
        canEdit={isAdmin}
        onEdit={(company) => {
          setEditing(company);
          setDialogOpen(true);
        }}
        onDelete={(company) => {
          setDeleteError(null);
          setDeleting(company);
        }}
      />

      <CompanyFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        company={editing}
        onSaved={() => {
          setDialogOpen(false);
          void utils.companies.list.invalidate();
        }}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the company. It cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleting(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (deleting) {
                  setDeleteError(null);
                  deleteMutation.mutate({ id: deleting.id });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
