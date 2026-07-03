"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { DeliveryFormDialog } from "@/components/admin/deliveries/delivery-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatLiters } from "@/lib/format";
import { api } from "@/lib/trpc/client";

/**
 * Deliveries register + entry. Create is SUPERVISOR (own site) or ADMIN;
 * MANAGER sees the register read-only (no operator path — security.md).
 */
export function DeliveriesClient() {
  const utils = api.useUtils();
  const me = api.auth.me.useQuery();
  const canRecord = me.data?.role === "ADMIN" || me.data?.role === "SUPERVISOR";

  const deliveries = api.deliveries.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = deliveries.data?.pages.flatMap((page) => page.deliveries) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Deliveries"
        description="Fuel entering tanks — every row is a DELIVERY movement in the append-only ledger."
        actions={
          canRecord ? (
            <Button onClick={() => setDialogOpen(true)}>Record delivery</Button>
          ) : undefined
        }
      />

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Delivered</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead>Liters</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Recorded by</TableHead>
              <TableHead>Balance after</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {deliveries.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  Loading deliveries…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  No deliveries recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="text-muted">
                    {formatDateTime(delivery.deliveredAt)}
                  </TableCell>
                  <TableCell className="font-semibold">{delivery.tankName}</TableCell>
                  <TableCell className="font-semibold text-info">
                    +{delivery.liters.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-muted">{delivery.supplierName ?? "—"}</TableCell>
                  <TableCell className="text-muted">{delivery.referenceNo ?? "—"}</TableCell>
                  <TableCell className="text-muted">{delivery.receivedByName}</TableCell>
                  <TableCell>
                    {delivery.balanceAfterLiters !== null
                      ? formatLiters(delivery.balanceAfterLiters)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {deliveries.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void deliveries.fetchNextPage()}
            disabled={deliveries.isFetchingNextPage}
          >
            {deliveries.isFetchingNextPage ? "Loading…" : "Load older deliveries"}
          </Button>
        </div>
      ) : null}

      <DeliveryFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          void utils.deliveries.list.invalidate();
          void utils.tanks.list.invalidate();
          void utils.tanks.stockSummary.invalidate();
          void utils.reconciliation.run.invalidate();
        }}
      />
    </div>
  );
}
