"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { AuditEventRow } from "@/components/admin/audit/audit-event-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/trpc/client";

const EXPORT_LINK_CLASS =
  "inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-slate-50";

/**
 * Export href for the audit trail. Points at the shared report-export route,
 * which re-runs the SAME server-side query under the same audit.view check —
 * the browser only carries the date range, never assembled data.
 */
function exportHref(format: "csv" | "xlsx", dateFrom: string, dateTo: string): string {
  const params = new URLSearchParams({ reportKey: "audit-trail", format });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  return `/api/reports/export?${params.toString()}`;
}

/** Read-only, append-only audit trail with cursor pagination (newest first). */
export function AuditClient() {
  const query = api.audit.list.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const rangeInvalid = dateFrom !== "" && dateTo !== "" && dateFrom > dateTo;

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title="Audit trail"
        description="Append-only record of logins, lockouts, and every master-data change. Rows are never edited or deleted."
      />

      <div className="rounded-2xl border border-border bg-card p-5 shadow-panel">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="audit-export-from">From</Label>
            <Input
              id="audit-export-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-export-to">To</Label>
            <Input
              id="audit-export-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </div>
          <div className="flex gap-3">
            {rangeInvalid ? (
              <>
                <span className={`${EXPORT_LINK_CLASS} cursor-not-allowed opacity-50`}>
                  <Download className="h-4 w-4" aria-hidden="true" /> CSV
                </span>
                <span className={`${EXPORT_LINK_CLASS} cursor-not-allowed opacity-50`}>
                  <Download className="h-4 w-4" aria-hidden="true" /> XLSX
                </span>
              </>
            ) : (
              <>
                <a
                  href={exportHref("csv", dateFrom, dateTo)}
                  className={EXPORT_LINK_CLASS}
                  download
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> CSV
                </a>
                <a
                  href={exportHref("xlsx", dateFrom, dateTo)}
                  className={EXPORT_LINK_CLASS}
                  download
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> XLSX
                </a>
              </>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          {rangeInvalid
            ? "The start date must be on or before the end date."
            : "Exports the trail for the selected range (leave blank for everything). The export is read-only and is itself recorded in the trail."}
        </p>
      </div>

      <div className="space-y-3">
        {query.isLoading ? (
          <p className="py-8 text-center text-sm text-muted">Loading audit events…</p>
        ) : query.error ? (
          // A failed query must never masquerade as an empty audit trail.
          <p
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-danger"
          >
            Could not load the audit trail. Refresh to retry; if it persists, check the server logs.
          </p>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No audit events yet.</p>
        ) : (
          events.map((event) => <AuditEventRow key={String(event.id)} event={event} />)
        )}
      </div>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load older events"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
