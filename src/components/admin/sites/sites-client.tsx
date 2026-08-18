"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { SiteFormDialog } from "@/components/admin/sites/site-form-dialog";
import { SiteTable, type SiteRow } from "@/components/admin/sites/site-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { api } from "@/lib/trpc/client";

export function SitesClient() {
  const utils = api.useUtils();
  const sites = api.sites.list.useQuery();
  const { can } = usePermissions();
  const canManage = can("masterdata.manage");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SiteRow | null>(null);

  const [deleting, setDeleting] = useState<SiteRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = api.sites.delete.useMutation({
    onSuccess: () => {
      setDeleting(null);
      void utils.sites.list.invalidate();
    },
    onError: (error) => setDeleteError(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Master data"
        title="Sites"
        description="Sites group tanks and users. Create a site before adding its tanks and operators."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              Add site
            </Button>
          ) : undefined
        }
      />

      <SiteTable
        sites={sites.data ?? []}
        isLoading={sites.isLoading}
        canEdit={canManage}
        onEdit={(site) => {
          setEditing(site);
          setDialogOpen(true);
        }}
        onDelete={(site) => {
          setDeleteError(null);
          setDeleting(site);
        }}
      />

      <SiteFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        site={editing}
        onSaved={() => {
          setDialogOpen(false);
          void utils.sites.list.invalidate();
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
              This permanently removes the site. It cannot be undone.
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
              {deleteMutation.isPending ? "Deleting…" : "Delete site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
