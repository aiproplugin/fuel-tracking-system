/**
 * Audit archive-and-prune CLI — `npm run archive-audit`.
 *
 *   npm run archive-audit
 *   npm run archive-audit -- --retain-months=24
 *   npm run archive-audit -- --archive-dir=/root/backups/audit
 *   npm run archive-audit -- --actor=admin        # attribute to a real user
 *   npm run archive-audit -- --dry-run            # report only, touch nothing
 *
 * Audit rows are PRESERVED, never merely deleted: rows older than the retention
 * window are written to a gzipped JSON Lines archive, the file is read back and
 * proven to hold exactly those rows, and only then are those exact ids removed.
 * Any failure leaves the trail completely untouched.
 *
 * Exit codes: 0 = archived, dry run, or nothing to do; 1 = verification failed
 * (ZERO rows removed) or an unexpected error. Suitable for a nightly cron on
 * the Linux server. Uses relative imports (tsx does not resolve the @ alias).
 */
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_RETENTION_MONTHS,
  archiveAuditLog,
} from "../src/server/services/audit-archive.service";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function retentionMonths(): number {
  const raw = flag("retain-months") ?? process.env.AUDIT_RETENTION_MONTHS;
  if (!raw) return DEFAULT_RETENTION_MONTHS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--retain-months must be a whole number of months, at least 1 (got "${raw}")`);
  }
  return parsed;
}

/** Resolve --actor=<username> to a user id, so the event names a real person. */
async function resolveActorId(): Promise<string | null> {
  const username = flag("actor");
  if (!username) return null;

  const user = await prisma.user.findUnique({
    where: { username: username.trim().toLowerCase() },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`--actor="${username}" does not match any user.`);
  }
  return user.id;
}

async function main(): Promise<number> {
  const months = retentionMonths();
  const archiveDir = flag("archive-dir") ?? process.env.AUDIT_ARCHIVE_DIR ?? "./backups/audit";
  const dryRun = process.argv.includes("--dry-run");
  const actorId = await resolveActorId();

  const result = await archiveAuditLog({ retentionMonths: months, archiveDir, actorId, dryRun });

  console.log(`Retention:  ${months} month(s) hot — archiving rows before ${result.cutoff}`);

  switch (result.outcome) {
    case "NOTHING_TO_ARCHIVE":
      console.log("NOTHING     No audit rows are older than the retention window.");
      return 0;

    case "DRY_RUN":
      console.log(
        `DRY RUN     ${result.selected} row(s) from ${result.oldest} to ${result.newest} would be archived to ${result.archivePath}. Nothing written, nothing deleted.`,
      );
      return 0;

    case "VERIFICATION_FAILED":
      console.error(
        `ABORTED     Archive could not be verified (${result.failureReason}). ZERO rows removed — the audit trail is untouched. Investigate ${result.archivePath} before retrying.`,
      );
      return 1;

    case "ARCHIVED":
      console.log(`ARCHIVED    ${result.selected} row(s) -> ${result.archivePath}`);
      console.log(`VERIFIED    archive holds exactly those ${result.selected} row(s)`);
      console.log(`PRUNED      ${result.deleted} row(s) removed from audit_log`);
      console.log(`\nRun again to archive the next batch if the trail is larger than one batch.`);
      return 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
