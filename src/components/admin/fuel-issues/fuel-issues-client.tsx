"use client";

import { useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import {
  ExceptionReviewDialog,
  type PendingException,
} from "@/components/admin/fuel-issues/exception-review-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status-icon";
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
import { formatEfficiency, formatMeter } from "@/lib/meter";
import { api } from "@/lib/trpc/client";

/**
 * Fuel Issues register + meter exception queue (D6). Supervisors see
 * their site read-only; only ADMIN gets the Review action.
 */
export function FuelIssuesClient() {
  const utils = api.useUtils();
  const me = api.auth.me.useQuery();
  const isAdmin = me.data?.role === "ADMIN";

  const exceptions = api.fuelIssues.exceptions.useQuery();
  const issues = api.fuelIssues.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const [reviewing, setReviewing] = useState<PendingException | null>(null);

  const rows = issues.data?.pages.flatMap((page) => page.issues) ?? [];
  const pending = exceptions.data?.pending ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Fuel Issues"
        description="Ledger-backed issue register. Every row has exactly one stock movement behind it."
      />

      {/* Exception queue (D6 entry point) */}
      {pending.length > 0 ? (
        <div className="rounded-[28px] border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <p className="font-bold">Exception queue</p>
            <span className="text-sm font-semibold text-danger">
              {pending.length} pending review
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {pending.map((exception) => (
              <div
                key={exception.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4 text-sm"
              >
                <StatusIcon kind="danger" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {exception.plateNumber} · attempted{" "}
                    {formatMeter(exception.attemptedReading, exception.meterType)} (last{" "}
                    {formatMeter(exception.previousReading, exception.meterType)})
                  </p>
                  <p className="text-muted">
                    {formatLiters(exception.liters)} · {exception.tankName} ·{" "}
                    {exception.operatorName} · {formatDateTime(exception.createdAt)}
                  </p>
                </div>
                {isAdmin ? (
                  <Button variant="dark" size="sm" onClick={() => setReviewing(exception)}>
                    Review
                  </Button>
                ) : (
                  <Badge variant="warning">Awaiting admin</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Register */}
      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead>Time</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Tank</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Liters</TableHead>
              <TableHead>Meter</TableHead>
              <TableHead>Efficiency</TableHead>
              <TableHead>Status</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {issues.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted">
                  Loading fuel issues…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted">
                  No fuel issues recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((issue) => (
                <TableRow key={issue.id}>
                  <TableCell className="text-muted">{formatDateTime(issue.issuedAt)}</TableCell>
                  <TableCell className="font-semibold">{issue.plateNumber}</TableCell>
                  <TableCell>{issue.tankName}</TableCell>
                  <TableCell className="text-muted">{issue.operatorName}</TableCell>
                  <TableCell className="font-semibold">{issue.liters.toFixed(1)}</TableCell>
                  <TableCell>{formatMeter(issue.meterReading, issue.meterType)}</TableCell>
                  <TableCell>
                    {issue.efficiency !== null
                      ? formatEfficiency(issue.efficiency, issue.meterType)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      {issue.isAbnormal ? <Badge variant="warning">Abnormal</Badge> : null}
                      {issue.meterOverride ? <Badge variant="info">Override</Badge> : null}
                      {!issue.isAbnormal && !issue.meterOverride ? (
                        <Badge variant="success">Issued</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {issues.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void issues.fetchNextPage()}
            disabled={issues.isFetchingNextPage}
          >
            {issues.isFetchingNextPage ? "Loading…" : "Load older issues"}
          </Button>
        </div>
      ) : null}

      <ExceptionReviewDialog
        exception={reviewing}
        onOpenChange={(open) => {
          if (!open) setReviewing(null);
        }}
        onReviewed={() => {
          setReviewing(null);
          void utils.fuelIssues.exceptions.invalidate();
          void utils.fuelIssues.list.invalidate();
          void utils.tanks.list.invalidate();
        }}
      />
    </div>
  );
}
