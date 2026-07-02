"use client";

import { Avatar } from "@/components/ui/avatar";
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
import { formatDateTime } from "@/lib/format";

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: "OPERATOR" | "SUPERVISOR" | "MANAGER" | "ADMIN";
  isActive: boolean;
  site: { id: string; name: string } | null;
  defaultTank: { id: string; name: string; fuelType: "PETROL" | "DIESEL" } | null;
  isLocked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | string | null;
}

const ROLE_BADGE: Record<UserRow["role"], "info" | "default" | "warning" | "success"> = {
  ADMIN: "info",
  MANAGER: "success",
  SUPERVISOR: "warning",
  OPERATOR: "default",
};

export interface UserTableProps {
  users: UserRow[];
  isLoading: boolean;
  onEdit: (user: UserRow) => void;
  onAssignTank: (user: UserRow) => void;
  onUnlock: (user: UserRow) => void;
  onResetPassword: (user: UserRow) => void;
}

export function UserTable({
  users,
  isLoading,
  onEdit,
  onAssignTank,
  onUnlock,
  onResetPassword,
}: UserTableProps) {
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <tr>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Site</TableHead>
            <TableHead>Assigned tank</TableHead>
            <TableHead>Last sign-in</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </tr>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted">
                Loading users…
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <span className="flex items-center gap-3">
                    <Avatar name={user.displayName} className="h-9 w-9 text-xs" />
                    <span>
                      <span className="block font-semibold">{user.displayName}</span>
                      <span className="block text-xs text-muted">{user.username}</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE[user.role]}>{user.role}</Badge>
                </TableCell>
                <TableCell className="text-muted">{user.site?.name ?? "—"}</TableCell>
                <TableCell>
                  {user.role !== "OPERATOR" ? (
                    <span className="text-muted">n/a</span>
                  ) : user.defaultTank ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-semibold">{user.defaultTank.name}</span>
                      <Badge variant={user.defaultTank.fuelType === "PETROL" ? "petrol" : "diesel"}>
                        {user.defaultTank.fuelType === "PETROL" ? "Petrol" : "Diesel"}
                      </Badge>
                    </span>
                  ) : (
                    <Badge variant="warning">Unassigned</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted">
                  {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1.5">
                    {user.isLocked ? (
                      <Badge variant="danger">Locked</Badge>
                    ) : user.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                    {user.mustChangePassword ? (
                      <Badge variant="warning">Temp password</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex justify-end gap-1">
                    {user.isLocked ? (
                      <Button variant="ghost" size="sm" onClick={() => onUnlock(user)}>
                        Unlock
                      </Button>
                    ) : null}
                    {user.role === "OPERATOR" ? (
                      <Button variant="ghost" size="sm" onClick={() => onAssignTank(user)}>
                        Assign tank
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => onResetPassword(user)}>
                      Reset password
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(user)}>
                      Edit
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
