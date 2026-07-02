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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/trpc/client";

type RoleValue = UserRow["role"];
const NO_SITE = "none";

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create mode. */
  user: UserRow | null;
  onSaved: () => void;
}

export function UserFormDialog({ open, onOpenChange, user, onSaved }: UserFormDialogProps) {
  const sites = api.sites.list.useQuery(undefined, { enabled: open });

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<RoleValue>("OPERATOR");
  const [siteId, setSiteId] = useState<string>(NO_SITE);
  const [isActive, setIsActive] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(user?.username ?? "");
      setPassword("");
      setDisplayName(user?.displayName ?? "");
      setRole(user?.role ?? "OPERATOR");
      setSiteId(user?.site?.id ?? NO_SITE);
      setIsActive(user?.isActive ?? true);
      setErrorMessage(null);
    }
  }, [open, user]);

  const createMutation = api.users.create.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const updateMutation = api.users.update.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    const resolvedSiteId = siteId === NO_SITE ? null : siteId;

    if (user) {
      updateMutation.mutate({
        id: user.id,
        displayName: displayName.trim(),
        role,
        siteId: resolvedSiteId,
        isActive,
      });
    } else {
      createMutation.mutate({
        username: username.trim().toLowerCase(),
        password,
        displayName: displayName.trim(),
        role,
        siteId: resolvedSiteId,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.username}` : "Add user"}</DialogTitle>
          <DialogDescription>
            {user
              ? "Role or site changes take effect at the user's next sign-in."
              : "The temporary password below must be replaced by the user at their first sign-in. 12+ characters with upper/lower case, a digit, and a symbol."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!user ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="user-username">Username</Label>
                <Input
                  id="user-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  minLength={3}
                  maxLength={64}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="user-password">Temporary password</Label>
                <Input
                  id="user-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="user-display-name">Display name</Label>
            <Input
              id="user-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              minLength={2}
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as RoleValue)}>
                <SelectTrigger id="user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">Operator</SelectItem>
                  <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-site">Site</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger id="user-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SITE}>No site</SelectItem>
                  {(sites.data ?? []).map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {user ? (
            <div className="space-y-1.5">
              <Label htmlFor="user-active">Status</Label>
              <Select
                value={isActive ? "active" : "inactive"}
                onValueChange={(value) => setIsActive(value === "active")}
              >
                <SelectTrigger id="user-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive (cannot sign in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

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
              {isSaving ? "Saving…" : user ? "Save changes" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
