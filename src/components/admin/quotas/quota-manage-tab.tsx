"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { QuotaPairFields } from "@/components/admin/quotas/quota-pair-fields";
import {
  formatEffectiveQuota,
  formatQuotaPair,
  type QuotaPeriodName,
  type QuotaSourceName,
} from "@/lib/format";
import { api } from "@/lib/trpc/client";

type QuotaPair = { liters: number; period: QuotaPeriodName } | null;

interface LayerTarget {
  kind: "company" | "vehicleType";
  id: string;
  name: string;
  current: QuotaPair;
}

interface ManagedVehicleRow {
  vehicleId: string;
  plateNumber: string;
  companyName: string;
  vehicleTypeName: string;
  quotaMode: "INHERIT" | "CUSTOM" | "EXEMPT";
  status: "QUOTA" | "EXEMPT" | "UNLIMITED";
  liters: number | null;
  period: QuotaPeriodName | null;
  source: QuotaSourceName | null;
}

/** ADMIN quota management: layer defaults, per-vehicle settings, bulk assign. */
export function QuotaManageTab() {
  const utils = api.useUtils();
  const companies = api.companies.list.useQuery();
  const vehicleTypes = api.vehicleTypes.list.useQuery();
  const status = api.quotas.status.useQuery({});

  const [layerTarget, setLayerTarget] = useState<LayerTarget | null>(null);
  const [vehicleTarget, setVehicleTarget] = useState<ManagedVehicleRow | null>(null);

  function invalidateAll() {
    void utils.quotas.invalidate();
    void utils.companies.list.invalidate();
    void utils.vehicleTypes.list.invalidate();
  }

  const vehicles: ManagedVehicleRow[] = status.data?.vehicles ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company defaults</CardTitle>
            <CardDescription>
              Applies to every vehicle of the company that is set to Inherit. Beats the
              vehicle-type default.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Company</TableHead>
                    <TableHead>Default quota</TableHead>
                    <TableHead />
                  </tr>
                </TableHeader>
                <TableBody>
                  {(companies.data ?? []).map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-semibold">{company.name}</TableCell>
                      <TableCell className="text-muted">
                        {company.defaultQuotaLiters !== null && company.defaultQuotaPeriod !== null
                          ? formatQuotaPair(company.defaultQuotaLiters, company.defaultQuotaPeriod)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLayerTarget({
                                kind: "company",
                                id: company.id,
                                name: company.name,
                                current:
                                  company.defaultQuotaLiters !== null &&
                                  company.defaultQuotaPeriod !== null
                                    ? {
                                        liters: company.defaultQuotaLiters,
                                        period: company.defaultQuotaPeriod,
                                      }
                                    : null,
                              })
                            }
                          >
                            Set quota
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vehicle-type defaults</CardTitle>
            <CardDescription>
              Applies to vehicles of the type when neither an individual setting nor a company
              default exists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableContainer>
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Type</TableHead>
                    <TableHead>Default quota</TableHead>
                    <TableHead />
                  </tr>
                </TableHeader>
                <TableBody>
                  {(vehicleTypes.data ?? []).map((type) => (
                    <TableRow key={type.id}>
                      <TableCell className="font-semibold">{type.name}</TableCell>
                      <TableCell className="text-muted">
                        {type.defaultQuotaLiters !== null && type.defaultQuotaPeriod !== null
                          ? formatQuotaPair(type.defaultQuotaLiters, type.defaultQuotaPeriod)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLayerTarget({
                                kind: "vehicleType",
                                id: type.id,
                                name: type.name,
                                current:
                                  type.defaultQuotaLiters !== null &&
                                  type.defaultQuotaPeriod !== null
                                    ? {
                                        liters: type.defaultQuotaLiters,
                                        period: type.defaultQuotaPeriod,
                                      }
                                    : null,
                              })
                            }
                          >
                            Set quota
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-vehicle settings</CardTitle>
          <CardDescription>
            Inherit follows the waterfall; Custom pins the vehicle&apos;s own pair; Exempt means
            explicitly no quota. The effective column always shows amount, period, and source.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TableContainer>
            <Table>
              <TableHeader>
                <tr>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Setting</TableHead>
                  <TableHead>Effective quota</TableHead>
                  <TableHead />
                </tr>
              </TableHeader>
              <TableBody>
                {status.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted">
                      Loading vehicles…
                    </TableCell>
                  </TableRow>
                ) : (
                  vehicles.map((vehicle) => (
                    <TableRow key={vehicle.vehicleId}>
                      <TableCell className="font-semibold">{vehicle.plateNumber}</TableCell>
                      <TableCell className="text-muted">{vehicle.companyName}</TableCell>
                      <TableCell className="text-muted">{vehicle.vehicleTypeName}</TableCell>
                      <TableCell>
                        <Badge variant={vehicle.quotaMode === "INHERIT" ? "outline" : "info"}>
                          {vehicle.quotaMode.charAt(0) +
                            vehicle.quotaMode.slice(1).toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted">
                        {formatEffectiveQuota(vehicle)}
                      </TableCell>
                      <TableCell>
                        <span className="flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setVehicleTarget(vehicle)}
                          >
                            Edit quota
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <BulkAssignCard onApplied={invalidateAll} />

      <LayerQuotaDialog
        target={layerTarget}
        onClose={() => setLayerTarget(null)}
        onSaved={() => {
          setLayerTarget(null);
          invalidateAll();
        }}
      />
      <VehicleQuotaDialog
        vehicle={vehicleTarget}
        onClose={() => setVehicleTarget(null)}
        onSaved={() => {
          setVehicleTarget(null);
          invalidateAll();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Company / vehicle-type default pair dialog
// ---------------------------------------------------------------------------

function LayerQuotaDialog({
  target,
  onClose,
  onSaved,
}: {
  target: LayerTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hasQuota, setHasQuota] = useState(false);
  const [liters, setLiters] = useState("");
  const [period, setPeriod] = useState<QuotaPeriodName>("MONTHLY");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Initialise the form when a new target opens (render-time state sync).
  if (target && openedFor !== target.id) {
    setOpenedFor(target.id);
    setHasQuota(target.current !== null);
    setLiters(target.current !== null ? String(target.current.liters) : "");
    setPeriod(target.current?.period ?? "MONTHLY");
    setErrorMessage(null);
  }

  const companyMutation = api.quotas.setCompanyQuota.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const typeMutation = api.quotas.setVehicleTypeQuota.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });
  const isSaving = companyMutation.isPending || typeMutation.isPending;

  function handleClose() {
    setOpenedFor(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    setErrorMessage(null);
    const quota = hasQuota ? { liters: Number(liters), period } : null;
    if (hasQuota && !(Number(liters) > 0)) {
      setErrorMessage("Enter the quota in litres (with its period).");
      return;
    }
    if (target.kind === "company") {
      companyMutation.mutate({ companyId: target.id, quota });
    } else {
      typeMutation.mutate({ vehicleTypeId: target.id, quota });
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Default quota · {target?.name}</DialogTitle>
          <DialogDescription>
            A quota is always litres + period together. Clearing the default lets lower waterfall
            layers apply.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="layer-quota-mode">Default</Label>
            <Select
              value={hasQuota ? "set" : "none"}
              onValueChange={(value) => setHasQuota(value === "set")}
            >
              <SelectTrigger id="layer-quota-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default (fall through)</SelectItem>
                <SelectItem value="set">Set a quota pair</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasQuota ? (
            <QuotaPairFields
              idPrefix="layer-quota"
              liters={liters}
              period={period}
              onLitersChange={setLiters}
              onPeriodChange={setPeriod}
            />
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-vehicle Inherit / Custom / Exempt dialog
// ---------------------------------------------------------------------------

function VehicleQuotaDialog({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: ManagedVehicleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"INHERIT" | "CUSTOM" | "EXEMPT">("INHERIT");
  const [liters, setLiters] = useState("");
  const [period, setPeriod] = useState<QuotaPeriodName>("MONTHLY");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  if (vehicle && openedFor !== vehicle.vehicleId) {
    setOpenedFor(vehicle.vehicleId);
    setMode(vehicle.quotaMode);
    const isCustom = vehicle.quotaMode === "CUSTOM" && vehicle.source === "VEHICLE_CUSTOM";
    setLiters(isCustom && vehicle.liters !== null ? String(vehicle.liters) : "");
    setPeriod(isCustom && vehicle.period !== null ? vehicle.period : "MONTHLY");
    setErrorMessage(null);
  }

  const mutation = api.quotas.setVehicleQuota.useMutation({
    onSuccess: onSaved,
    onError: (error) => setErrorMessage(error.message),
  });

  function handleClose() {
    setOpenedFor(null);
    onClose();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;
    setErrorMessage(null);
    if (mode === "CUSTOM" && !(Number(liters) > 0)) {
      setErrorMessage("A custom quota needs both litres and period.");
      return;
    }
    mutation.mutate({
      vehicleId: vehicle.vehicleId,
      mode,
      quota: mode === "CUSTOM" ? { liters: Number(liters), period } : null,
    });
  }

  return (
    <Dialog open={vehicle !== null} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quota · {vehicle?.plateNumber}</DialogTitle>
          <DialogDescription>
            Current effective: {vehicle ? formatEffectiveQuota(vehicle) : ""}. Custom overrides
            every default; Exempt disables the quota for this vehicle only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vehicle-quota-mode">Setting</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger id="vehicle-quota-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INHERIT">Inherit (company → type → global)</SelectItem>
                <SelectItem value="CUSTOM">Custom (own litres + period)</SelectItem>
                <SelectItem value="EXEMPT">Exempt (no quota)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "CUSTOM" ? (
            <QuotaPairFields
              idPrefix="vehicle-quota"
              liters={liters}
              period={period}
              onLitersChange={setLiters}
              onPeriodChange={setPeriod}
            />
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk assignment
// ---------------------------------------------------------------------------

function BulkAssignCard({ onApplied }: { onApplied: () => void }) {
  const companies = api.companies.list.useQuery();
  const vehicleTypes = api.vehicleTypes.list.useQuery();
  const sites = api.sites.list.useQuery();

  const [scope, setScope] = useState<"COMPANY" | "VEHICLE_TYPE" | "SITE">("COMPANY");
  const [scopeId, setScopeId] = useState("");
  const [action, setAction] = useState<"set" | "clear">("set");
  const [liters, setLiters] = useState("");
  const [period, setPeriod] = useState<QuotaPeriodName>("MONTHLY");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const bulkMutation = api.quotas.bulkAssign.useMutation({
    onSuccess: (result) => {
      setResultMessage(
        `Applied to ${result.vehiclesAffected} vehicle${result.vehiclesAffected === 1 ? "" : "s"}.`,
      );
      onApplied();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const scopeOptions =
    scope === "COMPANY"
      ? (companies.data ?? []).map((company) => ({ id: company.id, name: company.name }))
      : scope === "VEHICLE_TYPE"
        ? (vehicleTypes.data ?? []).map((type) => ({ id: type.id, name: type.name }))
        : (sites.data ?? []).map((site) => ({ id: site.id, name: site.name }));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setResultMessage(null);
    if (!scopeId) {
      setErrorMessage("Select what to apply the quota to.");
      return;
    }
    if (action === "set" && !(Number(liters) > 0)) {
      setErrorMessage("Enter the quota in litres (with its period).");
      return;
    }
    bulkMutation.mutate({
      scope,
      scopeId,
      quota: action === "set" ? { liters: Number(liters), period } : null,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk assignment</CardTitle>
        <CardDescription>
          Set a CUSTOM quota pair — or reset to Inherit — for all active vehicles of a company, of
          a vehicle type, or at a site (vehicles that have fuelled there). Audit-logged with the
          affected count.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-scope">Scope</Label>
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as typeof scope);
                setScopeId("");
              }}
            >
              <SelectTrigger id="bulk-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPANY">All vehicles of a company</SelectItem>
                <SelectItem value="VEHICLE_TYPE">All vehicles of a type</SelectItem>
                <SelectItem value="SITE">Vehicles at a site</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-target">Target</Label>
            <Select value={scopeId} onValueChange={setScopeId}>
              <SelectTrigger id="bulk-target">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bulk-action">Action</Label>
            <Select value={action} onValueChange={(value) => setAction(value as typeof action)}>
              <SelectTrigger id="bulk-action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="set">Set quota (litres + period)</SelectItem>
                <SelectItem value="clear">Clear — reset to Inherit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === "set" ? (
            <QuotaPairFields
              idPrefix="bulk-quota"
              liters={liters}
              period={period}
              onLitersChange={setLiters}
              onPeriodChange={setPeriod}
            />
          ) : null}

          {errorMessage ? (
            <p role="alert" className="text-sm font-medium text-danger sm:col-span-2 xl:col-span-4">
              {errorMessage}
            </p>
          ) : null}
          {resultMessage ? (
            <p className="text-sm font-medium text-success sm:col-span-2 xl:col-span-4">
              {resultMessage}
            </p>
          ) : null}

          <div className="sm:col-span-2 xl:col-span-4">
            <Button type="submit" disabled={bulkMutation.isPending}>
              {bulkMutation.isPending ? "Applying…" : "Apply"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
