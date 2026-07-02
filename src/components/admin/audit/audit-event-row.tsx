import { Badge } from "@/components/ui/badge";
import { StatusIcon, type StatusKind } from "@/components/ui/status-icon";
import { formatDateTime } from "@/lib/format";

/**
 * Row / AuditEvent molecule (prototype): status glyph, action, actor,
 * entity, IP, Colombo-rendered timestamp.
 */
export interface AuditEvent {
  id: bigint;
  action: string;
  actorUsername: string | null;
  actorDisplayName: string | null;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: Date | string;
}

function statusFor(action: string): StatusKind {
  if (action.includes("FAILURE") || action.includes("LOCKED") || action.includes("RATE_LIMITED")) {
    return "danger";
  }
  if (action.includes("ROTATED") || action.includes("DEACTIVATED") || action.includes("CHANGED")) {
    return "warning";
  }
  if (action.includes("SUCCESS") || action.includes("CREATED")) {
    return "success";
  }
  return "info";
}

export function AuditEventRow({ event }: { event: AuditEvent }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <StatusIcon kind={statusFor(event.action)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{event.action.replaceAll("_", " ")}</p>
        <p className="truncate text-xs text-muted">
          {event.actorDisplayName ?? "Anonymous"}
          {event.actorUsername ? ` (${event.actorUsername})` : ""}
          {event.entityType ? ` · ${event.entityType}` : ""}
        </p>
      </div>
      {event.ipAddress ? <Badge variant="outline">{event.ipAddress}</Badge> : null}
      <span className="text-xs text-muted">{formatDateTime(event.createdAt)}</span>
    </div>
  );
}
