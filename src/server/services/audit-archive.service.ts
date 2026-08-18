import { join } from "node:path";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  gzipJsonlStore,
  type ArchiveStore,
  type AuditArchiveRow,
} from "@/server/services/audit-archive-store";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * AUDIT ARCHIVE-AND-PRUNE.
 *
 * The audit trail's immutability is the system's core integrity property, so
 * rows are PRESERVED, never merely deleted. Removal exists ONLY as the verified
 * tail of an archive run:
 *
 *   select (older than retention) -> write archive -> VERIFY the file holds
 *   exactly those rows -> delete exactly those ids -> record AUDIT_ARCHIVED
 *
 * Any failure before the verify step returns with ZERO rows deleted. There is
 * deliberately NO tRPC procedure and NO UI control that reaches this: it is a
 * controlled server-side operation invoked from scripts/archive-audit.ts.
 *
 * AUDIT_ARCHIVED is emitted from THIS module rather than the CLI on purpose —
 * the audit-coverage lock scans src/server and src/app only, so an action
 * emitted from scripts/ would fail it.
 */

/** Keep a year of history hot by default; older rows are archived out. */
export const DEFAULT_RETENTION_MONTHS = 12;

/** Rows selected and deleted per batch, bounding memory and statement size. */
const BATCH_SIZE = 5_000;

export interface ArchiveAuditOptions {
  retentionMonths?: number;
  archiveDir?: string;
  /** Attribution for the AUDIT_ARCHIVED event; null for an unattended run. */
  actorId?: string | null;
  /** Select and report, but write nothing and delete nothing. */
  dryRun?: boolean;
  /** Injected for tests; defaults to the real gzip JSONL store. */
  store?: ArchiveStore;
  /** Injected for tests; defaults to the wall clock. */
  now?: Date;
}

export type ArchiveOutcome = "NOTHING_TO_ARCHIVE" | "DRY_RUN" | "ARCHIVED" | "VERIFICATION_FAILED";

export interface ArchiveAuditResult {
  outcome: ArchiveOutcome;
  /** Rows selected as older than the retention window. */
  selected: number;
  /** Rows actually removed from audit_log. ZERO unless outcome is ARCHIVED. */
  deleted: number;
  archivePath: string | null;
  cutoff: string;
  oldest: string | null;
  newest: string | null;
  /** Populated when outcome is VERIFICATION_FAILED. */
  failureReason: string | null;
}

/** Subtract whole months, clamping day-of-month (31 Mar - 1 month = 28/29 Feb). */
export function subtractMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Timestamp fragment for the filename: 20260818T071500Z. */
function fileStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * Archive every audit row older than the retention window, then remove exactly
 * those rows. Returns a result rather than throwing on verification failure, so
 * the caller can report precisely what did and did not happen.
 */
export async function archiveAuditLog(
  options: ArchiveAuditOptions = {},
): Promise<ArchiveAuditResult> {
  const {
    retentionMonths = DEFAULT_RETENTION_MONTHS,
    archiveDir = "./backups/audit",
    actorId = null,
    dryRun = false,
    store = gzipJsonlStore,
    now = new Date(),
  } = options;

  if (!Number.isInteger(retentionMonths) || retentionMonths < 1) {
    throw new Error("retentionMonths must be a whole number of months, at least 1.");
  }

  const cutoff = subtractMonths(now, retentionMonths);
  const where = { createdAt: { lt: cutoff } };

  const base: Omit<ArchiveAuditResult, "outcome"> = {
    selected: 0,
    deleted: 0,
    archivePath: null,
    cutoff: cutoff.toISOString(),
    oldest: null,
    newest: null,
    failureReason: null,
  };

  // Select the exact rows to archive, oldest first. Everything downstream keys
  // off THIS id list — never off the date predicate again, so a row written
  // during the run (including this run's own AUDIT_ARCHIVED event) can never be
  // deleted unarchived.
  const rows = await db.auditLog.findMany({
    where,
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      actorId: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      ipAddress: true,
      createdAt: true,
    },
  });

  if (rows.length === 0) {
    return { ...base, outcome: "NOTHING_TO_ARCHIVE" };
  }

  const archiveRows: AuditArchiveRow[] = rows.map((row) => ({
    // BigInt -> decimal string: JSON.stringify cannot serialize a BigInt, and a
    // JS number would silently lose precision past 2^53.
    id: row.id.toString(),
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before ?? null,
    after: row.after ?? null,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  }));

  const ids = archiveRows.map((row) => row.id);
  const oldest = archiveRows[0]!.createdAt;
  const newest = archiveRows[archiveRows.length - 1]!.createdAt;
  const archivePath = join(
    archiveDir,
    `audit-archive-${oldest.slice(0, 10)}_${newest.slice(0, 10)}-${fileStamp(now)}.jsonl.gz`,
  );

  if (dryRun) {
    return { ...base, outcome: "DRY_RUN", selected: rows.length, archivePath, oldest, newest };
  }

  // --- Write ---------------------------------------------------------------
  try {
    await store.write(archivePath, archiveRows);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "archive write failed";
    logger.error({ err: error, archivePath }, "Audit archive write failed; nothing deleted");
    return {
      ...base,
      outcome: "VERIFICATION_FAILED",
      selected: rows.length,
      archivePath,
      oldest,
      newest,
      failureReason: reason,
    };
  }

  // --- Verify (the gate) ----------------------------------------------------
  // Nothing below this point runs unless the file on disk demonstrably holds
  // exactly the rows we are about to remove.
  let verification;
  try {
    verification = await store.verify(archivePath, ids);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "archive verification failed";
    logger.error({ err: error, archivePath }, "Audit archive verification threw; nothing deleted");
    return {
      ...base,
      outcome: "VERIFICATION_FAILED",
      selected: rows.length,
      archivePath,
      oldest,
      newest,
      failureReason: reason,
    };
  }

  if (!verification.ok) {
    logger.error(
      { archivePath, reason: verification.reason, selected: rows.length },
      "Audit archive verification failed; nothing deleted",
    );
    return {
      ...base,
      outcome: "VERIFICATION_FAILED",
      selected: rows.length,
      archivePath,
      oldest,
      newest,
      failureReason: verification.reason,
    };
  }

  // --- Delete (only the verified ids) ---------------------------------------
  const bigintIds = ids.map((id) => BigInt(id));
  const removed = await db.auditLog.deleteMany({ where: { id: { in: bigintIds } } });

  // --- Account for it -------------------------------------------------------
  // Written AFTER the delete, and its own createdAt is `now` — later than the
  // cutoff — so this event survives its own run and every future one.
  await recordAuditEvent({
    actorId,
    action: "AUDIT_ARCHIVED",
    entityType: "audit_log",
    after: {
      archiveFile: archivePath,
      rowCount: removed.count,
      sha256: verification.sha256,
      window: { oldest, newest, cutoff: cutoff.toISOString() },
      retentionMonths,
      via: actorId === null ? "cli" : "cli-attributed",
    },
  });

  logger.info(
    { archivePath, deleted: removed.count, cutoff: cutoff.toISOString() },
    "Audit rows archived and pruned",
  );

  return {
    ...base,
    outcome: "ARCHIVED",
    selected: rows.length,
    deleted: removed.count,
    archivePath,
    oldest,
    newest,
  };
}
