/**
 * Session-record prune CLI — `npm run prune-sessions` (add
 * `-- --older-than=<minutes>` to override the default sweep window).
 *
 * Sessions are removed as they end: sign-out deletes its row, and an expired
 * session's row is deleted the moment it is rejected. What this sweeps up is
 * the remainder — browsers simply CLOSED, whose row sits untouched because no
 * further request ever arrives to trigger that rejection.
 *
 * Pruning is housekeeping, not enforcement: a row this job has not reached yet
 * is still rejected on sight by the jwt callback. Safe to schedule nightly
 * alongside `npm run reconcile`.
 *
 * The default window (31 days) deliberately exceeds the longest configurable
 * idle timeout (30 days, for operators), so a session that is merely idle but
 * still valid is never truncated. Exit code is always 0 unless the sweep
 * itself failed. Uses relative imports (tsx does not resolve the @ path alias).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** One day beyond the operator idle ceiling in src/lib/session-policy.ts. */
const DEFAULT_OLDER_THAN_MINUTES = 31 * 24 * 60;

function parseOlderThanMinutes(): number {
  const argument = process.argv.find((value) => value.startsWith("--older-than="));
  if (!argument) return DEFAULT_OLDER_THAN_MINUTES;

  const parsed = Number.parseInt(argument.slice("--older-than=".length), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--older-than must be a positive whole number of minutes (got "${argument}")`);
  }
  if (parsed < DEFAULT_OLDER_THAN_MINUTES) {
    console.warn(
      `WARNING: pruning at ${parsed} minutes is below the ${DEFAULT_OLDER_THAN_MINUTES}-minute safe window; idle-but-valid operator sessions may be signed out.`,
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const olderThanMinutes = parseOlderThanMinutes();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const { count } = await prisma.userSession.deleteMany({
    where: { lastActivityAt: { lt: cutoff } },
  });

  const remaining = await prisma.userSession.count();
  console.log(
    `Pruned ${count} session record(s) inactive since ${cutoff.toISOString()}; ${remaining} remaining.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
