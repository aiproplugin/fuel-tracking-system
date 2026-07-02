/**
 * In-memory sliding-window rate limiter.
 *
 * Deployment note: state is per-process, which fits the single-node on-prem
 * Windows Server target. If the app is ever scaled to multiple processes,
 * replace with a shared store (PostgreSQL or Redis) — tracked in
 * docs/security.md for Phase 7 review.
 */

export interface RateLimiterOptions {
  /** Maximum attempts allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** How long until the oldest hit leaves the window (0 when allowed). */
  retryAfterMs: number;
}

/** Sweep stale keys when the map grows beyond this size. */
const SWEEP_SIZE = 10_000;

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  const hitLog = new Map<string, number[]>();

  function sweep(now: number) {
    for (const [key, hits] of hitLog) {
      if (hits.every((timestamp) => timestamp <= now - windowMs)) {
        hitLog.delete(key);
      }
    }
  }

  return {
    /** Register an attempt for `key`; returns whether it is allowed. */
    consume(key: string, now: number = Date.now()): RateLimitResult {
      if (hitLog.size > SWEEP_SIZE) {
        sweep(now);
      }

      const windowStart = now - windowMs;
      const recentHits = (hitLog.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

      if (recentHits.length >= limit) {
        hitLog.set(key, recentHits);
        const oldestHit = recentHits[0] ?? now;
        return { allowed: false, remaining: 0, retryAfterMs: oldestHit + windowMs - now };
      }

      recentHits.push(now);
      hitLog.set(key, recentHits);
      return { allowed: true, remaining: limit - recentHits.length, retryAfterMs: 0 };
    },

    /** Clear all state (tests only). */
    reset(): void {
      hitLog.clear();
    },
  };
}

/** Login attempts: 10 per 5 minutes per IP+username key. */
export const loginRateLimiter = createRateLimiter({ limit: 10, windowMs: 5 * 60_000 });
