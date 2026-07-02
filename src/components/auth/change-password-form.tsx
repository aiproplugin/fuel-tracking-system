"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordSchema } from "@/lib/validation";
import { api } from "@/lib/trpc/client";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const changeMutation = api.auth.changePassword.useMutation({
    onSuccess: async () => {
      setIsDone(true);
      // The session claim is fixed at login, so re-authenticate with the
      // new password to obtain a clean session.
      await signOut({ callbackUrl: "/login" });
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (newPassword !== confirmPassword) {
      setErrorMessage("The new passwords do not match.");
      return;
    }
    // Client-side policy check is UX only; the server re-validates.
    const policy = passwordSchema.safeParse(newPassword);
    if (!policy.success) {
      setErrorMessage(policy.error.issues[0]?.message ?? "Password does not meet the policy.");
      return;
    }

    changeMutation.mutate({ currentPassword, newPassword });
  }

  if (isDone) {
    return (
      <p className="text-sm font-medium text-success">Password updated. Redirecting to sign in…</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          maxLength={128}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={12}
          maxLength={128}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={12}
          maxLength={128}
        />
      </div>

      {errorMessage ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={
          changeMutation.isPending ||
          currentPassword.length === 0 ||
          newPassword.length === 0 ||
          confirmPassword.length === 0
        }
      >
        {changeMutation.isPending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
