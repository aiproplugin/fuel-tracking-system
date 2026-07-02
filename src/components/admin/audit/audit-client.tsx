"use client";

import { PageHeader } from "@/components/admin/page-header";
import { AuditEventRow } from "@/components/admin/audit/audit-event-row";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/trpc/client";

/** Read-only, append-only audit trail with cursor pagination (newest first). */
export function AuditClient() {
  const query = api.audit.list.useInfiniteQuery(
    { limit: 50 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  const events = query.data?.pages.flatMap((page) => page.events) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Compliance"
        title="Audit trail"
        description="Append-only record of logins, lockouts, and every master-data change. Rows are never edited or deleted."
      />

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
