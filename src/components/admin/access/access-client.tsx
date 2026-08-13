"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { UserAccessPanel } from "@/components/admin/access/user-access-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RoleName } from "@/lib/permissions";
import { api } from "@/lib/trpc/client";

const ROLE_BADGE: Record<RoleName, "info" | "default" | "success" | "danger"> = {
  ADMIN: "danger",
  MANAGER: "info",
  SUPERVISOR: "success",
  OPERATOR: "default",
};

/**
 * Access Management (ADMIN, permission.manage). Lists every user with the size
 * of their effective permission set and how far it deviates from their role,
 * then drills into one user's full resolved set with the source of each entry.
 */
export function AccessClient() {
  const users = api.permissions.listUsers.useQuery();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access control"
        title="Access management"
        description="Roles are default permission bundles; per-user grants and denials adjust them. Denials always win. Changes take effect on the user's next request — no re-login needed."
      />

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Effective permissions</TableHead>
              <TableHead>Overrides</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted">
                  Loading…
                </TableCell>
              </TableRow>
            ) : (users.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted">
                  No users yet.
                </TableCell>
              </TableRow>
            ) : (
              (users.data ?? []).map((user) => (
                <TableRow key={user.userId}>
                  <TableCell>
                    <span className="font-semibold">{user.displayName}</span>
                    <span className="text-muted"> · {user.username}</span>
                    {!user.isActive ? (
                      <Badge variant="warning" className="ml-2">
                        Inactive
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ROLE_BADGE[user.role]}>{user.role}</Badge>
                  </TableCell>
                  <TableCell className="font-semibold">{user.effectiveCount}</TableCell>
                  <TableCell>
                    {user.grantCount === 0 && user.denyCount === 0 ? (
                      <span className="text-muted">Role defaults only</span>
                    ) : (
                      <span className="inline-flex gap-2">
                        {user.grantCount > 0 ? (
                          <Badge variant="success">+{user.grantCount} granted</Badge>
                        ) : null}
                        {user.denyCount > 0 ? (
                          <Badge variant="danger">−{user.denyCount} denied</Badge>
                        ) : null}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setSelectedUserId(selectedUserId === user.userId ? null : user.userId)
                      }
                    >
                      {selectedUserId === user.userId ? "Close" : "Manage access"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {selectedUserId ? (
        <UserAccessPanel
          userId={selectedUserId}
          onChanged={() => void users.refetch()}
          onClose={() => setSelectedUserId(null)}
        />
      ) : null}
    </div>
  );
}
