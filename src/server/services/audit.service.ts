import type { AuditAction, Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

export interface AuditEventInput {
  /** Null for anonymous events (e.g. failed login against unknown username). */
  actorId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  /** State snapshots where relevant; must never contain secrets or hashes. */
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Append one row to the append-only audit_log.
 *
 * Deliberately never throws: an audit-write failure must not turn into a
 * denial of service on login or business flows. The failure itself is
 * logged server-side at error level so it cannot pass silently.
 */
/**
 * Paginated audit trail (newest first, cursor on the BigInt id).
 * Read-only — there is deliberately no update or delete path anywhere.
 */
export async function listAuditEvents(input: { cursor?: bigint | null; limit: number }) {
  const rows = await db.auditLog.findMany({
    orderBy: { id: "desc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { actor: { select: { username: true, displayName: true } } },
  });

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;

  return {
    events: page.map((row) => ({
      id: row.id,
      action: row.action,
      actorUsername: row.actor?.username ?? null,
      actorDisplayName: row.actor?.displayName ?? null,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: event.actorId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        before: event.before,
        after: event.after,
        ipAddress: event.ipAddress ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: event.action }, "Failed to write audit_log row");
  }
}
