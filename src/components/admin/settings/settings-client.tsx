"use client";

import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { QuotaSettingsCard } from "@/components/admin/settings/quota-settings-card";
import { SessionPolicyCard } from "@/components/admin/settings/session-policy-card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { METER_CONFIG, METER_TYPES, type MeterTypeName } from "@/lib/meter";
import { api } from "@/lib/trpc/client";

interface EditState {
  id?: string;
  name: string;
  meterType: MeterTypeName;
  min: string;
  max: string;
}

/**
 * Settings — per-vehicle-type meter type + efficiency bands (the
 * abnormal-consumption bands, in the type's own unit per litre: km/L, hrs/L,
 * kWh/L). A fuel issue whose efficiency falls outside its type's band gets
 * flagged (Phase 3). The meter type locks once the type has recorded history
 * (server-enforced).
 */
export function SettingsClient() {
  const utils = api.useUtils();
  const types = api.vehicleTypes.list.useQuery();

  const [editing, setEditing] = useState<EditState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const upsertMutation = api.vehicleTypes.upsert.useMutation({
    onSuccess: () => {
      setEditing(null);
      setErrorMessage(null);
      void utils.vehicleTypes.list.invalidate();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setErrorMessage(null);
    upsertMutation.mutate({
      ...(editing.id ? { id: editing.id } : {}),
      name: editing.name.trim(),
      meterType: editing.meterType,
      minEfficiency: Number(editing.min),
      maxEfficiency: Number(editing.max),
    });
  }

  const editingUnit = editing ? METER_CONFIG[editing.meterType].efficiencyUnit : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Meter type and expected efficiency band per vehicle type (km/L, hrs/L, or kWh/L). Fuel issues outside their band are flagged as abnormal consumption."
        actions={
          <Button onClick={() => setEditing({ name: "", meterType: "DISTANCE", min: "", max: "" })}>
            Add vehicle type
          </Button>
        }
      />

      <QuotaSettingsCard />

      <SessionPolicyCard />

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Vehicle type</TableHead>
              <TableHead>Meter</TableHead>
              <TableHead>Expected band</TableHead>
              <TableHead>Vehicles</TableHead>
              <TableHead />
            </tr>
          </TableHeader>
          <TableBody>
            {types.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted">
                  Loading vehicle types…
                </TableCell>
              </TableRow>
            ) : (
              (types.data ?? []).map((type) => (
                <TableRow key={type.id}>
                  <TableCell className="font-semibold">{type.name}</TableCell>
                  <TableCell className="text-muted">
                    {METER_CONFIG[type.meterType].meterLabel} ({METER_CONFIG[type.meterType].unit})
                  </TableCell>
                  <TableCell>
                    {type.minEfficiency.toFixed(2)}–{type.maxEfficiency.toFixed(2)}{" "}
                    {METER_CONFIG[type.meterType].efficiencyUnit}
                  </TableCell>
                  <TableCell className="text-muted">{type.vehicleCount}</TableCell>
                  <TableCell>
                    <span className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            id: type.id,
                            name: type.name,
                            meterType: type.meterType,
                            min: String(type.minEfficiency),
                            max: String(type.maxEfficiency),
                          })
                        }
                      >
                        Edit band
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {editing ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing.id ? `Edit ${editing.name}` : "New vehicle type"}</CardTitle>
            <CardDescription>
              Minimum must be below maximum, in the meter type&apos;s efficiency unit. The meter
              type cannot change once vehicles of this type have recorded fuel issues. Changes are
              audit-logged with before/after values.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="type-name">Name</Label>
                <Input
                  id="type-name"
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  required
                  minLength={2}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type-meter">Meter type</Label>
                <Select
                  value={editing.meterType}
                  onValueChange={(value) =>
                    setEditing({ ...editing, meterType: value as MeterTypeName })
                  }
                >
                  <SelectTrigger id="type-meter">
                    <SelectValue placeholder="Select meter type" />
                  </SelectTrigger>
                  <SelectContent>
                    {METER_TYPES.map((meterType) => (
                      <SelectItem key={meterType} value={meterType}>
                        {METER_CONFIG[meterType].meterLabel} ({METER_CONFIG[meterType].unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type-min">Min ({editingUnit})</Label>
                <Input
                  id="type-min"
                  type="number"
                  min={0.1}
                  step="0.01"
                  value={editing.min}
                  onChange={(event) => setEditing({ ...editing, min: event.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type-max">Max ({editingUnit})</Label>
                <Input
                  id="type-max"
                  type="number"
                  min={0.1}
                  step="0.01"
                  value={editing.max}
                  onChange={(event) => setEditing({ ...editing, max: event.target.value })}
                  required
                />
              </div>

              {errorMessage ? (
                <p
                  role="alert"
                  className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-4"
                >
                  {errorMessage}
                </p>
              ) : null}

              <div className="flex gap-3 sm:col-span-2 lg:col-span-4">
                <Button type="submit" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending ? "Saving…" : "Save band"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
