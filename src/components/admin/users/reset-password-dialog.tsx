"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { UserRow } from "@/components/admin/users/user-table";
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

export interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  onSaved: () => void;
}

/**
 * ADMIN sets a TEMPORARY password; the user must replace it at their next
 * sign-in. The value is write-only: never echoed back, never logged,
 * audited as PASSWORD_RESET without the secret.
 */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: ResetPasswordDialogProps) {
  const [newPassword, setNewPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNewPassword("");
      setErrorMessage(null);
    }
  }, [open]);

  const resetMutation = api.users.resetPassword.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (user) {
      resetMutation.mutate({ userId: user.id, newPassword });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password{user ? ` — ${user.username}` : ""}</DialogTitle>
          <DialogDescription>
            Sets a temporary password and unlocks the account. {user?.displayName ?? "The user"}{" "}
            must choose their own password at the next sign-in. An existing session stays valid
            until it expires or they sign out.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">Temporary password</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              maxLength={128}
            />
            <p className="text-xs text-muted">
              12+ characters with upper/lower case, a digit, and a symbol.
            </p>
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
            <Button type="submit" disabled={resetMutation.isPending || newPassword.length === 0}>
              {resetMutation.isPending ? "Resetting…" : "Set temporary password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
