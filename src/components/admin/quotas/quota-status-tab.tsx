"use client";

import { useState, type FormEvent } from "react";
import type { Role } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDateTime,
  formatEffectiveQuota,
  formatLiters,
  type QuotaPeriodName,
  type QuotaSourceName,
} from "@/lib/format";
import { api } from "@/lib/trpc/client";

interface QuotaVehicleRow {
  vehicleId: string;
  plateNumber: string;
  companyName: string;
  vehicleTypeName: string;
  status: "QUOTA" | "EXEMPT" | "UNLIMITED";
  liters: number | null;
  period: QuotaPeriodName | null;
  source: QuotaSourceName | null;
  capLiters: number | null;
  consumedLiters: number;
  remainingLiters: number | null;
  percentUsed: number | null;
  state: "EXEMPT" | "UNLIMITED" | "OK" | "APPROACHING" | "OVER";
}

const STATE_BADGE: Record<
  QuotaVehicleRow["state"],
  { variant: "danger" | "warning" | "success" | "outline"; label: string }
> = {
  OVER: { variant: "danger", label: "Over quota" },
  APPROACHING: { variant: "warning", label: "Approaching" },
  OK: { variant: "success", label: "OK" },
  EXEMPT: { variant: "outline", label: "Exempt" },
  UNLIMITED: { variant: "outline", label: "No quota" },
};

export interface QuotaStatusTabProps {
  isAdmin: boolean;
  role: Role | undefined;
}

export function QuotaStatusTab({ isAdmin, role }: QuotaStatusTabProps) {
  const canFilterSite = role === "MANAGER" || role === "ADMIN";
  const [siteId, setSiteId] = useState<string>("all");

  const status = api.quotas.status.useQuery(
    canFilterSite && siteId !== "all" ? { siteId } : {},
    { placeholderData: (previous) => previous },
  );
  const sites = api.sites.list.useQuery(undefined, { enabled: canFilterSite });

  const [codeVehicle, setCodeVehicle] = useState<QuotaVehicleRow | null>(null);
  const [topUpVehicle, setTopUpVehicle] = useState<QuotaVehicleRow | null>(null);

  const settings = status.data?.settings;
  const vehicles: QuotaVehicleRow[] = status.data?.vehicles ?? [];
  const companySummary = status.data?.companySummary ?? [];

  return (
    <div className="space-y-6">
      {settings && !settings.enforcementEnabled ? (
        <p className="rounded-2xl bg-warning/10 px-4 py-3 text-sm font-medium text-text">
          Quota enforcement is switched OFF — figures below are informational and nothing is
          blocked. Enable it in Settings.
        </p>
      ) : null}

      {canFilterSite ? (
        <div className="max-w-xs">
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger aria-label="Filter by site">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sites</SelectItem>
              {(sites.data ?? []).map((site) => (
                <SelectItem key={site.id} value={site.id}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {companySummary.map((company) => (
          <Card key={company.companyId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                {company.companyName}
                {company.overCount > 0 ? (
                  <Badge variant="danger">{company.overCount} over</Badge>
                ) : company.approachingCount > 0 ? (
                  <Badge variant="warning">{company.approachingCount} approaching</Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {company.quotaVehicleCount === 0 ? (
                <p className="text-sm text-muted">
                  {company.vehicleCount} vehicle{company.vehicleCount === 1 ? "" : "s"}, none with
                  a quota.
                </p>
              ) : (
                <div className="space-y-1 text-sm">
                  <p className="text-2xl font-bold text-text">
                    {company.percentUsed !== null ? `${company.percentUsed}%` : "—"}
                    <span className="ml-2 text-sm font-medium text-muted">used this period</span>
                  </p>
                  <p className="text-muted">
                    {formatLiters(company.consumedLiters)} of{" "}
                    {formatLiters(company.totalQuotaLiters)} · {formatLiters(company.remainingLiters)}{" "}
                    remaining · {company.quotaVehicleCount} quota vehicle
                    {company.quotaVehicleCount === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Vehicle</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Effective quota</TableHead>
              <TableHead>Consumed</TableHead>
              <TableHead>Remaining</TableHead>
              <TableHead>% used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </tr>
          </TableHeader>
          <TableBody>
            {status.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted">
                  Loading quota status…
                </TableCell>
              </TableRow>
            ) : vehicles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted">
                  No vehicles in scope. Supervisors see vehicles that fuelled at their site
                  recently.
                </TableCell>
              </TableRow>
            ) : (
              vehicles.map((vehicle) => {
                const badge = STATE_BADGE[vehicle.state];
                return (
                  <TableRow key={vehicle.vehicleId}>
                    <TableCell className="font-semibold">{vehicle.plateNumber}</TableCell>
                    <TableCell className="text-muted">{vehicle.companyName}</TableCell>
                    <TableCell className="text-muted">{formatEffectiveQuota(vehicle)}</TableCell>
                    <TableCell>
                      {vehicle.status === "QUOTA" ? formatLiters(vehicle.consumedLiters) : "—"}
                    </TableCell>
                    <TableCell>
                      {vehicle.remainingLiters !== null
                        ? formatLiters(vehicle.remainingLiters)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {vehicle.percentUsed !== null ? `${vehicle.percentUsed}%` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {vehicle.status === "QUOTA" ? (
                          <Button variant="ghost" size="sm" onClick={() => setCodeVehicle(vehicle)}>
                            Override code
                          </Button>
                        ) : null}
                        {isAdmin && vehicle.status === "QUOTA" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTopUpVehicle(vehicle)}
                          >
                            Top-up
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <OverrideCodeDialog vehicle={codeVehicle} onClose={() => setCodeVehicle(null)} />
      <TopUpDialog
        vehicle={topUpVehicle}
        onClose={() => setTopUpVehicle(null)}
        onSaved={() => {
          setTopUpVehicle(null);
          void status.refetch();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Override-code dialog (SUPERVISOR+): mint a single-use 6-digit code
// ---------------------------------------------------------------------------

function OverrideCodeDialog({
  vehicle,
  onClose,
}: {
  vehicle: QuotaVehicleRow | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const issueMutation = api.quotas.issueOverrideCode.useMutation({
    onError: (error) => setErrorMessage(error.message),
  });

  function handleClose() {
    setReason("");
    setErrorMessage(null);
    issueMutation.reset();
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;
    setErrorMessage(null);
    issueMutation.mutate({ vehicleId: vehicle.vehicleId, reason: reason.trim() });
  }

  return (
    <Dialog open={vehicle !== null} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override code · {vehicle?.plateNumber}</DialogTitle>
          <DialogDescription>
            Authorises ONE over-quota fill for this vehicle. The code is single-use, expires in 10
            minutes, and the override is audit-logged with your name.
          </DialogDescription>
        </DialogHeader>

        {issueMutation.data ? (
          <div className="space-y-2 rounded-2xl bg-bg p-5 text-center">
            <p className="text-sm text-muted">Give this code to the operator</p>
            <p className="text-4xl font-extrabold tracking-[0.3em] text-text">
              {issueMutation.data.code}
            </p>
            <p className="text-sm text-muted">
              Valid until {formatDateTime(issueMutation.data.expiresAt)}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="override-reason">Reason</Label>
              <Input
                id="override-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is extra fuel authorised?"
                required
                minLength={5}
                maxLength={500}
              />
            </div>
            {errorMessage ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {errorMessage}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={issueMutation.isPending}>
                {issueMutation.isPending ? "Issuing…" : "Issue code"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {issueMutation.data ? (
          <DialogFooter>
            <Button type="button" onClick={handleClose}>
              Done
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Top-up dialog (ADMIN): one-off extra litres inside the current window
// ---------------------------------------------------------------------------

function TopUpDialog({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: QuotaVehicleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [liters, setLiters] = useState("");
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const topUpMutation = api.quotas.grantTopUp.useMutation({
    onSuccess: () => {
      setLiters("");
      setReason("");
      onSaved();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleClose() {
    setLiters("");
    setReason("");
    setErrorMessage(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;
    setErrorMessage(null);
    topUpMutation.mutate({
      vehicleId: vehicle.vehicleId,
      liters: Number(liters),
      reason: reason.trim(),
    });
  }

  return (
    <Dialog open={vehicle !== null} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top-up · {vehicle?.plateNumber}</DialogTitle>
          <DialogDescription>
            Grants one-off extra litres for the CURRENT {vehicle?.period?.toLowerCase() ?? ""}{" "}
            window only. Audit-logged with the reason.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topup-liters">Extra litres</Label>
            <Input
              id="topup-liters"
              type="number"
              min={1}
              step="0.01"
              value={liters}
              onChange={(event) => setLiters(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topup-reason">Reason</Label>
            <Input
              id="topup-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is extra fuel needed this period?"
              required
              minLength={5}
              maxLength={500}
            />
          </div>
          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={topUpMutation.isPending}>
              {topUpMutation.isPending ? "Granting…" : "Grant top-up"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
