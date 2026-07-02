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
