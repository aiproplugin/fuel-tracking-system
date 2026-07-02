/**
 * Account lockout policy — pure functions, no I/O, fully unit-tested.
 *
 * Policy: after LOCKOUT_THRESHOLD consecutive failures the account locks for
 * BASE_LOCK_MINUTES, doubling with every further failure (exponential
 * backoff) up to MAX_LOCK_MINUTES. A successful login resets the counter.
 */

export const LOCKOUT_THRESHOLD = 5;
export const BASE_LOCK_MINUTES = 15;
export const MAX_LOCK_MINUTES = 24 * 60;

/**
 * Lock expiry for a given consecutive-failure count, or null while the
 * account is still under the threshold.
 */
export function computeLockedUntil(failedLoginCount: number, now: Date): Date | null {
  if (failedLoginCount < LOCKOUT_THRESHOLD) {
    return null;
  }
  const escalations = failedLoginCount - LOCKOUT_THRESHOLD;
  const minutes = Math.min(BASE_LOCK_MINUTES * 2 ** escalations, MAX_LOCK_MINUTES);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Whether an account is currently locked. */
export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}
