"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, type PermissionSource, type RoleName } from "@/lib/permissions";
import { api } from "@/lib/trpc/client";

/** How each source reads in the UI — provenance is never left implicit. */
const SOURCE_LABEL: Record<PermissionSource, string> = {
  role: "From role",
  granted: "Granted",
  denied: "Denied",
  none: "Not held",
};

const SOURCE_VARIANT: Record<PermissionSource, "default" | "success" | "danger" | "outline"> = {
  role: "default",
  granted: "success",
  denied: "danger",
  none: "outline",
};

export interface UserAccessPanelProps {
  userId: string;
  onChanged: () => void;
  onClose: () => void;
}

/**
 * One user's RESOLVED effective permissions, grouped, with the source of every
 * entry and controls to grant, deny, or clear an override.
 *
 * Guardrail violations are reported by the server and surfaced verbatim — the
 * message names the conflicting permissions, so an admin learns why a
 * combination is refused rather than just that it failed.
 */
export function UserAccessPanel({ userId, onChanged, onClose }: UserAccessPanelProps) {
  const utils = api.useUtils();
  const access = api.permissions.userAccess.useQuery({ userId });

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<RoleName | null>(null);

  function refresh() {
    setError(null);
    setReason("");
    setPendingRole(null);
    void utils.permissions.userAccess.invalidate({ userId });
    onChanged();
  }

  const onError = (mutationError: { message: string }) => setError(mutationError.message);

  const setOverride = api.permissions.setOverride.useMutation({ onSuccess: refresh, onError });
  const removeOverride = api.permissions.removeOverride.useMutation({
    onSuccess: refresh,
    onError,
  });
  const changeRole = api.permissions.changeRole.useMutation({ onSuccess: refresh, onError });

  const busy = setOverride.isPending || removeOverride.isPending || changeRole.isPending;
  const detail = access.data;

  /** A reason is mandatory on every change — the audit trail records why. */
  function requireReason(): string | null {
    if (reason.trim().length < 4) {
      setError("Give a reason for this access change (at least 4 characters).");
      return null;
    }
    return reason.trim();
  }

  if (access.isLoading || !detail) {
    return (
      <div className="rounded-[20px] border border-border bg-card p-6 shadow-panel">
        <p className="text-muted">Loading access detail…</p>
      </div>
    );
  }

  const groups = [...new Set(detail.permissions.map((row) => row.group))];

  return (
    <div className="space-y-5 rounded-[20px] border border-border bg-card p-6 shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{detail.displayName}</h2>
          <p className="text-sm text-muted">
            {detail.username} · {detail.permissions.filter((row) => row.held).length} effective
            permissions
            {detail.isLastActiveAdmin ? " · last active administrator" : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-danger">Change refused</p>
          <p className="mt-1 text-sm text-red-800">{error}</p>
        </div>
      ) : null}

      {/* Reason applies to whichever change is made next. */}
      <div className="space-y-1.5">
        <Label htmlFor="access-reason">Reason (recorded in the audit trail)</Label>
        <Input
          id="access-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. covering stock control while the supervisor is on leave"
          maxLength={500}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-bg p-4">
        <div className="space-y-1.5">
          <Label htmlFor="access-role">Role (default permission bundle)</Label>
          <Select
            value={pendingRole ?? detail.role}
            onValueChange={(value) => setPendingRole(value as RoleName)}
          >
            <SelectTrigger id="access-role" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          disabled={busy || pendingRole === null || pendingRole === detail.role}
          onClick={() => {
            const value = requireReason();
            if (!value || !pendingRole) return;
            changeRole.mutate({ userId, role: pendingRole, reason: value });
          }}
        >
          Change role
        </Button>
        {!detail.hasDefaultTank ? (
          <p className="text-sm text-muted">
            No tank assigned — fuel.issue cannot be granted until one is bound.
          </p>
        ) : null}
      </div>

      {groups.map((group) => (
        <section key={group} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{group}</h3>
          <ul className="space-y-2">
            {detail.permissions
              .filter((row) => row.group === group)
              .map((row) => (
                <li
                  key={row.permission}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-3"
                >
                  <div className="min-w-64 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{row.label}</span>
                      <code className="text-xs text-muted">{row.permission}</code>
                      <Badge variant={SOURCE_VARIANT[row.source]}>
                        {SOURCE_LABEL[row.source]}
                      </Badge>
                      {row.adminOnly ? <Badge variant="outline">ADMIN role only</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted">{row.description}</p>

                    {/* The one grant no pair-based invariant can express. */}
                    {row.widensDataVisibility && row.permission === "report.view.all" ? (
                      <p className="mt-1 text-sm font-semibold text-warning">
                        Granting this widens data visibility to ALL sites, not just this
                        user&apos;s own.
                      </p>
                    ) : null}

                    {row.override ? (
                      <p className="mt-1 text-xs text-muted">
                        {row.override.mode === "GRANT" ? "Granted" : "Denied"} by{" "}
                        {row.override.grantedBy} — {row.override.reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy || row.source === "granted" || row.adminOnly}
                      onClick={() => {
                        const value = requireReason();
                        if (!value) return;
                        setOverride.mutate({
                          userId,
                          permission: row.permission,
                          mode: "GRANT",
                          reason: value,
                        });
                      }}
                    >
                      Grant
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || row.source === "denied"}
                      onClick={() => {
                        const value = requireReason();
                        if (!value) return;
                        setOverride.mutate({
                          userId,
                          permission: row.permission,
                          mode: "DENY",
                          reason: value,
                        });
                      }}
                    >
                      Deny
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || row.override === null}
                      onClick={() => {
                        const value = requireReason();
                        if (!value) return;
                        removeOverride.mutate({
                          userId,
                          permission: row.permission,
                          reason: value,
                        });
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
