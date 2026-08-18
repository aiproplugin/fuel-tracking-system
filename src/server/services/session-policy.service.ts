import type { Role } from "@prisma/client";
import { logger } from "@/lib/logger";
import { ROLES, type RoleName } from "@/lib/permissions";
import type { UpdateSessionPoliciesInput } from "@/lib/schemas/session-policy";
import {
  POLICY_CACHE_TTL_MS,
  defaultSessionPolicies,
  evaluateSession,
  validateIdleMinutes,
} from "@/lib/session-policy";
import { db } from "@/server/db";
import { recordAuditEvent } from "@/server/services/audit.service";

/**
 * SESSION LIFETIME SERVICE.
 *
 * Owns two things: the admin-configurable per-role idle timeouts, and the
 * per-sign-in activity records the jwt callback consults on every request.
 *
 * WHERE EXPIRY IS DECIDED: only in `resolveSessionState`, called only from the
 * Auth.js `jwt` callback (src/server/auth/config.ts). There is deliberately no
 * client-side timer anywhere in the app — a countdown in the browser is a
 * display, never a control, and the jwt callback runs on every session read so
 * no request path can skip it.
 *
 * ⚠ BACKGROUND POLLING BREAKS THIS. Any request resets the idle clock,
 * including a background refetch the user never asked for. NEVER add polling
 * (`refetchInterval`, timers, heartbeats) to a Supervisor/Manager/Admin screen:
 * a screen left open would refresh its own session forever and the idle timeout
 * would silently stop firing. Operator screens may poll — operators are
 * persistent by design (see the standing rule in CLAUDE.md).
 */

// ---------------------------------------------------------------------------
// Configured policy (per-role rows; in-code defaults until first save)
// ---------------------------------------------------------------------------

export interface SessionPolicyValues {
  role: RoleName;
  /** Minutes of inactivity before sign-out; null = persistent. */
  idleMinutes: number | null;
}

interface PolicyCache {
  readAt: number;
  values: Record<RoleName, number | null>;
}

/**
 * Short-lived process cache. Bounds the per-request cost to one 4-row read per
 * TTL window while keeping a changed timeout effective for ALREADY-ACTIVE
 * sessions on their next activity: saving invalidates it immediately in this
 * process, and the TTL bounds staleness anywhere else to 10 seconds.
 */
let policyCache: PolicyCache | null = null;

/**
 * Force the next policy read to hit the database. Called on every save so a
 * changed timeout applies immediately in this process; also the hook tests use
 * to start from a known state.
 */
export function invalidateSessionPolicyCache(): void {
  policyCache = null;
}

async function readPolicies(): Promise<Record<RoleName, number | null>> {
  const cached = policyCache;
  if (cached !== null && Date.now() - cached.readAt < POLICY_CACHE_TTL_MS) {
    return cached.values;
  }

  const rows = await db.sessionPolicy.findMany();
  const values = defaultSessionPolicies();
  for (const row of rows) {
    values[row.role] = row.idleMinutes;
  }

  policyCache = { readAt: Date.now(), values };
  return values;
}

/** Effective policy for every role, defaults filled in. */
export async function getSessionPolicies(): Promise<SessionPolicyValues[]> {
  const values = await readPolicies();
  return ROLES.map((role) => ({ role, idleMinutes: values[role] }));
}

/**
 * Save every role's idle timeout and audit the change.
 *
 * Bounds are re-checked here against the same catalogue the Zod schema uses:
 * the router already rejects an out-of-band value, and this second pass keeps
 * the guarantee if the service is ever called from a script or a future caller
 * that skips the schema.
 */
export async function updateSessionPolicies(
  actorId: string,
  input: UpdateSessionPoliciesInput,
): Promise<SessionPolicyValues[]> {
  for (const policy of input.policies) {
    const error = validateIdleMinutes(policy.role, policy.idleMinutes);
    if (error !== null) {
      throw new Error(error);
    }
  }

  // Snapshot as a role -> minutes map: it reads cleanly in the audit trail and
  // diffs role-by-role, which an array of objects does not.
  const before = { ...(await readPolicies()) };

  await db.$transaction(
    input.policies.map((policy) =>
      db.sessionPolicy.upsert({
        where: { role: policy.role as Role },
        update: { idleMinutes: policy.idleMinutes },
        create: { role: policy.role as Role, idleMinutes: policy.idleMinutes },
      }),
    ),
  );

  invalidateSessionPolicyCache();
  const after = { ...(await readPolicies()) };

  await recordAuditEvent({
    actorId,
    action: "SESSION_SETTINGS_UPDATED",
    entityType: "session_policy",
    before,
    after,
  });

  return ROLES.map((role) => ({ role, idleMinutes: after[role] }));
}

// ---------------------------------------------------------------------------
// Per-sign-in session records
// ---------------------------------------------------------------------------

/** Record a new sign-in. Called once, from the jwt callback's sign-in branch. */
export async function createUserSession(params: {
  sid: string;
  userId: string;
  role: RoleName;
}): Promise<void> {
  await db.userSession.create({
    data: {
      id: params.sid,
      userId: params.userId,
      role: params.role as Role,
      lastActivityAt: new Date(),
    },
  });
}

/** Sign-out, and the cleanup half of expiry. Safe to call for an absent sid. */
export async function deleteUserSession(sid: string): Promise<void> {
  await db.userSession.deleteMany({ where: { id: sid } });
}

export type SessionState = "ACTIVE" | "REJECTED";

/**
 * THE session gate: is this sid still usable, and if so, mark it active.
 *
 * FAILS CLOSED. An unknown sid — pruned, revoked, deleted with its user, or
 * simply forged — is REJECTED, never given the benefit of the doubt. So is a
 * session whose idle or absolute limit has passed; its row is removed so the
 * decision cannot be re-litigated.
 *
 * A DB error also fails closed: if we cannot prove the session is alive, we do
 * not let it through.
 */
export async function resolveSessionState(sid: string): Promise<SessionState> {
  try {
    const session = await db.userSession.findUnique({ where: { id: sid } });
    if (session === null) {
      return "REJECTED";
    }

    const policies = await readPolicies();
    const evaluation = evaluateSession({
      role: session.role,
      idleMinutes: policies[session.role],
      lastActivityAt: session.lastActivityAt,
      createdAt: session.createdAt,
      now: new Date(),
    });

    if (evaluation.verdict !== "ACTIVE") {
      await deleteUserSession(sid);
      // Session lifecycle is operational detail, not an audit event: it carries
      // no actor decision. The audit trail records the LOGOUT the user takes
      // and the SESSION_SETTINGS_UPDATED an admin makes.
      logger.info(
        { userId: session.userId, role: session.role, verdict: evaluation.verdict },
        "Session expired",
      );
      return "REJECTED";
    }

    if (evaluation.shouldTouch) {
      await db.userSession.update({
        where: { id: sid },
        data: { lastActivityAt: new Date() },
      });
    }

    return "ACTIVE";
  } catch (error) {
    logger.error({ err: error }, "Session state lookup failed; rejecting session");
    return "REJECTED";
  }
}

/**
 * Delete session rows that no live cookie could still reference — the sweep for
 * browsers simply closed, which leave a row until their next (rejected)
 * request. Used by scripts/prune-sessions.ts.
 *
 * `olderThanMinutes` must exceed the longest configured idle timeout, so this
 * never truncates a session that is merely idle-but-valid.
 */
export async function pruneUserSessions(olderThanMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await db.userSession.deleteMany({
    where: { lastActivityAt: { lt: cutoff } },
  });
  return result.count;
}
