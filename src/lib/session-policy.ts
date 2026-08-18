import { ROLES, type RoleName } from "@/lib/permissions";

/**
 * THE single home for session-lifetime policy — per-role idle timeouts, the
 * absolute cap, the cookie type, and the bounds an admin may configure.
 *
 * TWO INDEPENDENT LIMITS, whichever fires first:
 *   1. IDLE     — expires after N minutes with no server request. Any request
 *                 resets it, so nobody is logged out mid-task.
 *   2. ABSOLUTE — expires N minutes after sign-in REGARDLESS of activity, so a
 *                 privileged session cannot be kept alive indefinitely. Only
 *                 privileged roles carry one.
 * Plus a third, browser-side limit for privileged roles: their session cookie
 * carries no Expires/Max-Age, so closing the browser drops it (see
 * server/auth/session-cookie-policy.ts).
 *
 * Every value below is a DEFAULT. The idle timeout is admin-configurable per
 * role within [minIdleMinutes, maxIdleMinutes]; the absolute cap and the
 * cookie type are NOT configurable — they are the fixed floor of the control.
 *
 * All timeout labels, bounds, defaults, and cookie decisions live ONLY in this
 * module. Adding a role = one Prisma enum value + one entry here (completeness
 * is enforced by the Record type and unit-tested against ROLES). Nothing
 * anywhere else may branch on a role name to decide session behaviour.
 */

/** Minutes in 30 days — the ceiling for an operator's idle timeout. */
const THIRTY_DAYS_MINUTES = 30 * 24 * 60;

/**
 * Absolute ceiling on any JWT, in seconds — this is Auth.js's static
 * `session.maxAge`, which bounds the token's `exp` and the operator cookie's
 * Expires. It is deliberately generous (operators must survive browser
 * restarts across shifts); it is NOT the security control. The real limits are
 * the per-role idle timeout and absolute cap enforced in the jwt callback.
 */
export const SESSION_TOKEN_CEILING_SECONDS = THIRTY_DAYS_MINUTES * 60;

/**
 * Don't write `last_activity_at` more often than this. Bounds the write load
 * to one UPDATE per session per minute while keeping the idle clock accurate
 * to within a minute — the same throttling idea as Auth.js's own `updateAge`.
 */
export const ACTIVITY_WRITE_THROTTLE_SECONDS = 60;

/** How long a resolved policy may be reused before re-reading the table. */
export const POLICY_CACHE_TTL_MS = 10_000;

/** Cookie lifetime kind. BROWSER_SESSION carries no Expires/Max-Age. */
export type SessionCookieMode = "PERSISTENT" | "BROWSER_SESSION";

export interface SessionPolicyConfig {
  /** Role label for the settings card. */
  label: string;
  /** Default idle timeout when no row exists yet. `null` = never idle-expires. */
  defaultIdleMinutes: number | null;
  /** Inclusive lower bound an admin may configure. */
  minIdleMinutes: number;
  /** Inclusive upper bound an admin may configure. */
  maxIdleMinutes: number;
  /**
   * May this role be set to "persistent" (no idle expiry at all)? False for
   * every privileged role — that is what stops an admin disabling the control.
   */
  persistentAllowed: boolean;
  /** Whether the session cookie survives browser close. */
  cookie: SessionCookieMode;
  /** Hard cap from sign-in regardless of activity; `null` = none. */
  absoluteMaxMinutes: number | null;
  /** Guidance shown under the field in Settings. */
  helper: string;
}

/**
 * Privileged roles share one profile: 15-minute default idle, 5–120 minute
 * configurable band, a 12-hour absolute cap, and a browser-session cookie.
 * OPERATOR is the deliberate exception — pump tablets stay signed in across
 * shifts, so it is persistent by default with no absolute cap.
 */
const PRIVILEGED: Omit<SessionPolicyConfig, "label" | "helper"> = {
  defaultIdleMinutes: 15,
  minIdleMinutes: 5,
  maxIdleMinutes: 120,
  persistentAllowed: false,
  cookie: "BROWSER_SESSION",
  absoluteMaxMinutes: 12 * 60,
};

export const SESSION_POLICY_CONFIG: Record<RoleName, SessionPolicyConfig> = {
  OPERATOR: {
    label: "Operator",
    defaultIdleMinutes: null,
    minIdleMinutes: 5,
    maxIdleMinutes: THIRTY_DAYS_MINUTES,
    persistentAllowed: true,
    cookie: "PERSISTENT",
    absoluteMaxMinutes: null,
    helper:
      "Pump tablets stay signed in across shifts and browser restarts. Persistent is the default; set an idle timeout only if a site needs one.",
  },
  SUPERVISOR: {
    ...PRIVILEGED,
    label: "Supervisor",
    helper:
      "Signs out after this long without activity, on browser close, and 12 hours after sign-in.",
  },
  MANAGER: {
    ...PRIVILEGED,
    label: "Manager",
    helper:
      "Signs out after this long without activity, on browser close, and 12 hours after sign-in.",
  },
  ADMIN: {
    ...PRIVILEGED,
    label: "Administrator",
    helper:
      "Signs out after this long without activity, on browser close, and 12 hours after sign-in.",
  },
};

/** Cookie kind for a role — the ONE place this is decided. */
export function sessionCookieMode(role: RoleName): SessionCookieMode {
  return SESSION_POLICY_CONFIG[role].cookie;
}

/** Defaults keyed by role, used until an admin saves a policy. */
export function defaultSessionPolicies(): Record<RoleName, number | null> {
  const defaults = {} as Record<RoleName, number | null>;
  for (const role of ROLES) {
    defaults[role] = SESSION_POLICY_CONFIG[role].defaultIdleMinutes;
  }
  return defaults;
}

/**
 * Validate a proposed idle timeout for a role. Returns an error message, or
 * null when the value is acceptable.
 *
 * This is the single source of truth for the bounds: the Zod input schema and
 * the service both call it, so the client can never submit a value the server
 * would not have produced itself. A DB CHECK constraint mirrors it as a last
 * line of defence.
 */
export function validateIdleMinutes(role: RoleName, idleMinutes: number | null): string | null {
  const config = SESSION_POLICY_CONFIG[role];

  if (idleMinutes === null) {
    return config.persistentAllowed
      ? null
      : `${config.label} sessions must have an idle timeout — persistent sessions are not allowed for this role.`;
  }

  if (!Number.isInteger(idleMinutes)) {
    return "Idle timeout must be a whole number of minutes.";
  }
  if (idleMinutes < config.minIdleMinutes || idleMinutes > config.maxIdleMinutes) {
    return `${config.label} idle timeout must be between ${config.minIdleMinutes} and ${config.maxIdleMinutes} minutes.`;
  }
  return null;
}

/** Why a session was rejected — surfaced to logs, never to the client. */
export type SessionVerdict = "ACTIVE" | "IDLE_EXPIRED" | "ABSOLUTE_EXPIRED";

export interface SessionEvaluation {
  verdict: SessionVerdict;
  /** True when `last_activity_at` is stale enough to be worth writing. */
  shouldTouch: boolean;
}

/**
 * THE session-lifetime decision — pure, so it is unit-tested without a DB or a
 * browser. Callers (only the jwt callback, via session-policy.service) act on
 * the verdict; nothing here reads the clock or performs I/O.
 *
 * @param role           Role recorded on the session row at sign-in.
 * @param idleMinutes    Configured idle timeout; null = no idle expiry.
 * @param lastActivityAt Timestamp of the last request on this session.
 * @param createdAt      Sign-in time, for the absolute cap.
 * @param now            Current time, injected.
 */
export function evaluateSession(params: {
  role: RoleName;
  idleMinutes: number | null;
  lastActivityAt: Date;
  createdAt: Date;
  now: Date;
}): SessionEvaluation {
  const { role, idleMinutes, lastActivityAt, createdAt, now } = params;
  const { absoluteMaxMinutes } = SESSION_POLICY_CONFIG[role];

  const ageMs = now.getTime() - createdAt.getTime();
  if (absoluteMaxMinutes !== null && ageMs >= absoluteMaxMinutes * 60_000) {
    return { verdict: "ABSOLUTE_EXPIRED", shouldTouch: false };
  }

  const idleMs = now.getTime() - lastActivityAt.getTime();
  if (idleMinutes !== null && idleMs >= idleMinutes * 60_000) {
    return { verdict: "IDLE_EXPIRED", shouldTouch: false };
  }

  return {
    verdict: "ACTIVE",
    shouldTouch: idleMs >= ACTIVITY_WRITE_THROTTLE_SECONDS * 1_000,
  };
}
