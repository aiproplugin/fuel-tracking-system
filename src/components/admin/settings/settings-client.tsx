"use client";

import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/trpc/client";

interface EditState {
  id?: string;
  name: string;
  min: string;
  max: string;
}

/**
 * Settings — per-vehicle-type km/L bounds (the abnormal-consumption bands).
 * A fuel issue whose efficiency falls outside its type's band gets flagged
 * (Phase 3).
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
      minKmPerLiter: Number(editing.min),
      maxKmPerLiter: Number(editing.max),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Expected km/L band per vehicle type. Fuel issues outside their band are flagged as abnormal consumption."
        actions={
          <Button onClick={() => setEditing({ name: "", min: "", max: "" })}>
            Add vehicle type
          </Button>
        }
      />

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Vehicle type</TableHead>
              <TableHead>Min km/L</TableHead>
              <TableHead>Max km/L</TableHead>
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
                  <TableCell>{type.minKmPerLiter.toFixed(2)}</TableCell>
                  <TableCell>{type.maxKmPerLiter.toFixed(2)}</TableCell>
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
                            min: String(type.minKmPerLiter),
                            max: String(type.maxKmPerLiter),
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
              Minimum must be below maximum. Changes are audit-logged with before/after values.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
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
                <Label htmlFor="type-min">Min km/L</Label>
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
                <Label htmlFor="type-max">Max km/L</Label>
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
                <p role="alert" className="text-sm font-medium text-danger sm:col-span-3">
                  {errorMessage}
                </p>
              ) : null}

              <div className="flex gap-3 sm:col-span-3">
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
