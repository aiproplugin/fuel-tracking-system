"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { AssignTankDialog } from "@/components/admin/users/assign-tank-dialog";
import { ResetPasswordDialog } from "@/components/admin/users/reset-password-dialog";
import { UserFormDialog } from "@/components/admin/users/user-form-dialog";
import { UserTable, type UserRow } from "@/components/admin/users/user-table";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";

export function UsersClient() {
  const utils = api.useUtils();
  const users = api.users.list.useQuery();

  const [formOpen, setFormOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);

  const unlockMutation = api.users.unlock.useMutation({
    onSuccess: () => void utils.users.list.invalidate(),
  });

  function refresh() {
    setFormOpen(false);
    setAssignOpen(false);
    setResetOpen(false);
    void utils.users.list.invalidate();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access control"
        title="Users"
        description="Accounts, roles, and operator tank bindings. Tank changes take effect at the operator's next sign-in."
        actions={
          <Button
            onClick={() => {
              setSelected(null);
              setFormOpen(true);
            }}
          >
            Add user
          </Button>
        }
      />

      <UserTable
        users={users.data ?? []}
        isLoading={users.isLoading}
        onEdit={(user) => {
          setSelected(user);
          setFormOpen(true);
        }}
        onAssignTank={(user) => {
          setSelected(user);
          setAssignOpen(true);
        }}
        onUnlock={(user) => unlockMutation.mutate({ userId: user.id })}
        onResetPassword={(user) => {
          setSelected(user);
          setResetOpen(true);
        }}
      />

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={selected}
        onSaved={refresh}
      />
      <AssignTankDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        user={selected}
        onSaved={refresh}
      />
      <ResetPasswordDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        user={selected}
        onSaved={refresh}
      />
    </div>
  );
}
