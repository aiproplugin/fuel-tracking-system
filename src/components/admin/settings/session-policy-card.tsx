"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, type RoleName } from "@/lib/permissions";
import { SESSION_POLICY_CONFIG } from "@/lib/session-policy";
import { api } from "@/lib/trpc/client";

type DraftMode = "IDLE" | "PERSISTENT";

interface Draft {
  mode: DraftMode;
  minutes: string;
}

function initialDrafts(): Record<RoleName, Draft> {
  const drafts = {} as Record<RoleName, Draft>;
  for (const role of ROLES) {
    const config = SESSION_POLICY_CONFIG[role];
    drafts[role] =
      config.defaultIdleMinutes === null
        ? { mode: "PERSISTENT", minutes: "" }
        : { mode: "IDLE", minutes: String(config.defaultIdleMinutes) };
  }
  return drafts;
}

/**
 * Session timeouts per role — the idle period after which a signed-in user is
 * signed out. Any request resets the timer, so nobody is logged out mid-task.
 *
 * The bounds rendered here come from SESSION_POLICY_CONFIG, the same catalogue
 * the server validates against. They are UX only: the tRPC input schema rejects
 * an out-of-band value regardless of what this form allows.
 */
export function SessionPolicyCard() {
  const utils = api.useUtils();
  const policies = api.sessionPolicy.getSettings.useQuery();

  const [drafts, setDrafts] = useState<Record<RoleName, Draft>>(initialDrafts);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const data = policies.data;
    if (!data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const policy of data) {
        next[policy.role] =
          policy.idleMinutes === null
            ? { mode: "PERSISTENT", minutes: "" }
            : { mode: "IDLE", minutes: String(policy.idleMinutes) };
      }
      return next;
    });
  }, [policies.data]);

  const updateMutation = api.sessionPolicy.updateSettings.useMutation({
    onSuccess: () => {
      setSavedAt(Date.now());
      void utils.sessionPolicy.invalidate();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);

    const payload: Array<{ role: RoleName; idleMinutes: number | null }> = [];
    for (const role of ROLES) {
      const draft = drafts[role];
      if (draft.mode === "PERSISTENT") {
        payload.push({ role, idleMinutes: null });
        continue;
      }
      const minutes = Number(draft.minutes);
      if (!Number.isInteger(minutes)) {
        setErrorMessage(
          `Enter a whole number of minutes for ${SESSION_POLICY_CONFIG[role].label}.`,
        );
        return;
      }
      payload.push({ role, idleMinutes: minutes });
    }

    updateMutation.mutate({ policies: payload });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session timeouts</CardTitle>
        <CardDescription>
          How long a signed-in session survives without activity. Any action resets the timer, so
          nobody is signed out mid-task. Supervisor, Manager, and Administrator sessions
          additionally end when the browser closes and 12 hours after sign-in, whichever comes
          first. Changes apply to sessions already signed in, on their next action.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {ROLES.map((role) => {
              const config = SESSION_POLICY_CONFIG[role];
              const draft = drafts[role];
              return (
                <div key={role} className="space-y-1.5">
                  <Label htmlFor={`session-${role}`}>{config.label}</Label>
                  {config.persistentAllowed ? (
                    <Select
                      value={draft.mode}
                      onValueChange={(value) =>
                        setDrafts({
                          ...drafts,
                          [role]: {
                            mode: value as DraftMode,
                            minutes:
                              value === "IDLE" && draft.minutes === "" ? "720" : draft.minutes,
                          },
                        })
                      }
                    >
                      <SelectTrigger id={`session-${role}-mode`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERSISTENT">
                          Persistent — stays signed in across browser restarts
                        </SelectItem>
                        <SelectItem value="IDLE">Sign out after an idle period</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}

                  {draft.mode === "IDLE" ? (
                    <Input
                      id={`session-${role}`}
                      type="number"
                      min={config.minIdleMinutes}
                      max={config.maxIdleMinutes}
                      step={1}
                      value={draft.minutes}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [role]: { ...draft, minutes: event.target.value },
                        })
                      }
                      required
                    />
                  ) : null}

                  <p className="text-sm text-muted">
                    {config.helper}
                    {config.persistentAllowed
                      ? ""
                      : ` Allowed range: ${config.minIdleMinutes}–${config.maxIdleMinutes} minutes.`}
                  </p>
                </div>
              );
            })}
          </div>

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={updateMutation.isPending || policies.isLoading}>
              {updateMutation.isPending ? "Saving…" : "Save session timeouts"}
            </Button>
            {savedAt !== null ? (
              <span className="text-sm font-medium text-success">Saved.</span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
