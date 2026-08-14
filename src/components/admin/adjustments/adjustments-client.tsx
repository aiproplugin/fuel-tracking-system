"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { AdjustmentFormDialog } from "@/components/admin/adjustments/adjustment-form-dialog";
import { Badge } from "@/components/ui/badge";
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
import { ADJUSTMENT_REASON_CONFIG } from "@/lib/adjustment-reason";
import { formatDateTime, formatLiters } from "@/lib/format";
import { api } from "@/lib/trpc/client";

/**
 * Adjustments register + entry. Create is SUPERVISOR (own site) or ADMIN —
 * MANAGER is excluded per the project rules and sees this read-only.
 */
export function AdjustmentsClient() {
  const utils = api.useUtils();
  const me = api.auth.me.useQuery();
  const canRecord = me.data?.role === "ADMIN" || me.data?.role === "SUPERVISOR";

  const adjustments = api.adjustments.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  const rows = adjustments.data?.pages.flatMap((page) => page.adjustments) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Adjustments"
        description="Signed stock corrections with mandatory reasons — each one an ADJUSTMENT movement in the ledger."
        actions={
          canRecord ? (
            <Button onClick={() => setDialogOpen(true)}>Record adjustment</Button>
          ) : undefined
        }
      />

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>When</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>By</TableHead>
              <TableHead>Balance after</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {adjustments.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  Loading adjustments…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted">
                  No adjustments recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((adjustment) => (
                <TableRow key={adjustment.id}>
                  <TableCell className="text-muted">
                    {formatDateTime(adjustment.adjustedAt)}
                  </TableCell>
                  <TableCell className="font-semibold">{adjustment.tankName}</TableCell>
                  <TableCell
                    className={`font-semibold ${adjustment.quantityChange < 0 ? "text-danger" : "text-info"}`}
                  >
                    {adjustment.quantityChange > 0 ? "+" : ""}
                    {adjustment.quantityChange.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={ADJUSTMENT_REASON_CONFIG[adjustment.reasonCategory].badgeVariant}
                      title={ADJUSTMENT_REASON_CONFIG[adjustment.reasonCategory].label}
                    >
                      {ADJUSTMENT_REASON_CONFIG[adjustment.reasonCategory].shortLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted" title={adjustment.reason}>
                    {adjustment.reason}
                  </TableCell>
                  <TableCell className="text-muted">{adjustment.adjustedByName}</TableCell>
                  <TableCell>
                    {adjustment.balanceAfterLiters !== null
                      ? formatLiters(adjustment.balanceAfterLiters)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {adjustments.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void adjustments.fetchNextPage()}
            disabled={adjustments.isFetchingNextPage}
          >
            {adjustments.isFetchingNextPage ? "Loading…" : "Load older adjustments"}
          </Button>
        </div>
      ) : null}

      <AdjustmentFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false);
          void utils.adjustments.list.invalidate();
          void utils.tanks.list.invalidate();
          void utils.tanks.stockSummary.invalidate();
          void utils.reconciliation.run.invalidate();
        }}
      />
    </div>
  );
}
