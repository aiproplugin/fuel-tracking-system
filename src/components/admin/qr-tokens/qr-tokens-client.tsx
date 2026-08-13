"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { FUEL_CONFIG, fuelLabel } from "@/lib/fuel";
import { api } from "@/lib/trpc/client";

/**
 * QR token lifecycle per vehicle. Tokens are opaque; the QR sheet is the
 * only artifact that ever leaves the system, and rotating instantly
 * invalidates the previous sheet.
 */
export function QrTokensClient() {
  const utils = api.useUtils();
  const rows = api.qrTokens.list.useQuery();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = () => {
    setErrorMessage(null);
    void utils.qrTokens.list.invalidate();
    void utils.vehicles.list.invalidate();
  };
  const onError = (error: { message: string }) => setErrorMessage(error.message);

  const createMutation = api.qrTokens.create.useMutation({ onSuccess: refresh, onError });
  const rotateMutation = api.qrTokens.rotate.useMutation({ onSuccess: refresh, onError });
  const deactivateMutation = api.qrTokens.deactivate.useMutation({ onSuccess: refresh, onError });
  const isMutating =
    createMutation.isPending || rotateMutation.isPending || deactivateMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access control"
        title="QR Tokens"
        description="Opaque scan tokens per vehicle — never the plate. Rotating a token immediately invalidates the printed sheet in the field."
      />

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-danger"
        >
          {errorMessage}
        </p>
      ) : null}

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Vehicle</TableHead>
              <TableHead>Fuel</TableHead>
              <TableHead>Active token since</TableHead>
              <TableHead>Tokens issued</TableHead>
              <TableHead />
            </tr>
          </TableHeader>
          <TableBody>
            {rows.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted">
                  Loading tokens…
                </TableCell>
              </TableRow>
            ) : (
              (rows.data ?? []).map((row) => (
                <TableRow key={row.vehicleId}>
                  <TableCell className="font-semibold">{row.plateNumber}</TableCell>
                  <TableCell>
                    <Badge variant={FUEL_CONFIG[row.fuelType].badgeVariant}>
                      {fuelLabel(row.fuelType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted">
                    {row.activeToken ? (
                      formatDateTime(row.activeToken.createdAt)
                    ) : (
                      <Badge variant="warning">No active token</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted">{row.totalIssued}</TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      {row.activeToken ? (
                        <>
                          <Link
                            href={`/print/qr/${row.vehicleId}`}
                            target="_blank"
                            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                          >
                            Print
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isMutating}
                            onClick={() => rotateMutation.mutate({ vehicleId: row.vehicleId })}
                          >
                            Rotate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger"
                            disabled={isMutating}
                            onClick={() =>
                              deactivateMutation.mutate({ tokenId: row.activeToken!.id })
                            }
                          >
                            Deactivate
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isMutating || !row.vehicleIsActive}
                          onClick={() => createMutation.mutate({ vehicleId: row.vehicleId })}
                        >
                          Generate token
                        </Button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
