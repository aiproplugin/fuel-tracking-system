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
import { api } from "@/lib/trpc/client";

const PERIOD_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

const MODE_OPTIONS = [
  { value: "WARN_OVERRIDE", label: "Warn — supervisor override allowed" },
  { value: "HARD_BLOCK", label: "Hard block — over-quota is refused" },
  { value: "OFF", label: "Off — show quota for information only" },
] as const;

const WEEK_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

type QuotaPeriod = (typeof PERIOD_OPTIONS)[number]["value"];
type EnforcementMode = (typeof MODE_OPTIONS)[number]["value"];
type WeekDay = (typeof WEEK_DAYS)[number];

/**
 * Fuel quota configuration: the group-wide master switch, enforcement mode,
 * warning threshold, week-start day, and the GLOBAL DEFAULT quota pair
 * (bottom of the resolution waterfall). Amount and period are always edited
 * together.
 */
export function QuotaSettingsCard() {
  const utils = api.useUtils();
  const settings = api.quotas.getSettings.useQuery();

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<EnforcementMode>("WARN_OVERRIDE");
  const [threshold, setThreshold] = useState("80");
  const [weekStart, setWeekStart] = useState<WeekDay>("MONDAY");
  const [hasGlobal, setHasGlobal] = useState(false);
  const [globalLiters, setGlobalLiters] = useState("");
  const [globalPeriod, setGlobalPeriod] = useState<QuotaPeriod>("MONTHLY");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    setEnabled(data.enforcementEnabled);
    setMode(data.enforcementMode);
    setThreshold(String(data.warningThresholdPct));
    setWeekStart(data.weekStartDay);
    const hasPair = data.globalQuotaLiters !== null && data.globalQuotaPeriod !== null;
    setHasGlobal(hasPair);
    setGlobalLiters(hasPair ? String(data.globalQuotaLiters) : "");
    setGlobalPeriod(data.globalQuotaPeriod ?? "MONTHLY");
  }, [settings.data]);

  const updateMutation = api.quotas.updateSettings.useMutation({
    onSuccess: () => {
      setSavedAt(Date.now());
      void utils.quotas.invalidate();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSavedAt(null);
    if (hasGlobal && !(Number(globalLiters) > 0)) {
      setErrorMessage("Enter the global default quota in litres (with its period).");
      return;
    }
    updateMutation.mutate({
      enforcementEnabled: enabled,
      enforcementMode: mode,
      warningThresholdPct: Number(threshold) || 80,
      weekStartDay: weekStart,
      globalQuota: hasGlobal ? { liters: Number(globalLiters), period: globalPeriod } : null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fuel quotas</CardTitle>
        <CardDescription>
          Master switch for quota enforcement across the whole group. OFF keeps every configured
          quota but disables all checks and displays. A quota is always litres + period together.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="quota-enabled">Quota enforcement</Label>
            <Select
              value={enabled ? "on" : "off"}
              onValueChange={(value) => setEnabled(value === "on")}
            >
              <SelectTrigger id="quota-enabled">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off — no quota checks anywhere</SelectItem>
                <SelectItem value="on">On</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quota-mode">Enforcement mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as EnforcementMode)}>
              <SelectTrigger id="quota-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quota-threshold">Warning threshold (%)</Label>
            <Input
              id="quota-threshold"
              type="number"
              min={1}
              max={100}
              step={1}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quota-week-start">Week starts on</Label>
            <Select value={weekStart} onValueChange={(value) => setWeekStart(value as WeekDay)}>
              <SelectTrigger id="quota-week-start">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_DAYS.map((day) => (
                  <SelectItem key={day} value={day}>
                    {day.charAt(0) + day.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quota-global">Global default quota</Label>
            <Select
              value={hasGlobal ? "set" : "none"}
              onValueChange={(value) => setHasGlobal(value === "set")}
            >
              <SelectTrigger id="quota-global">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — vehicles without a layer are unlimited</SelectItem>
                <SelectItem value="set">Set a group-wide default</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasGlobal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quota-global-liters">Litres</Label>
                <Input
                  id="quota-global-liters"
                  type="number"
                  min={1}
                  step="0.01"
                  value={globalLiters}
                  onChange={(event) => setGlobalLiters(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quota-global-period">Period</Label>
                <Select
                  value={globalPeriod}
                  onValueChange={(value) => setGlobalPeriod(value as QuotaPeriod)}
                >
                  <SelectTrigger id="quota-global-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={updateMutation.isPending || settings.isLoading}>
              {updateMutation.isPending ? "Saving…" : "Save quota settings"}
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
