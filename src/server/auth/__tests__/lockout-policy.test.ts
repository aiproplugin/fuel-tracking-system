import { describe, expect, it } from "vitest";
import {
  BASE_LOCK_MINUTES,
  computeLockedUntil,
  isLocked,
  LOCKOUT_THRESHOLD,
  MAX_LOCK_MINUTES,
} from "@/server/auth/lockout-policy";

const now = new Date("2026-07-02T05:00:00.000Z");
const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe("computeLockedUntil", () => {
  it("does not lock below the threshold", () => {
    for (let count = 0; count < LOCKOUT_THRESHOLD; count++) {
      expect(computeLockedUntil(count, now)).toBeNull();
    }
  });

  it("locks for the base duration at the threshold", () => {
    expect(computeLockedUntil(LOCKOUT_THRESHOLD, now)).toEqual(minutesFromNow(BASE_LOCK_MINUTES));
  });

  it("doubles the lock duration with each further failure", () => {
    expect(computeLockedUntil(LOCKOUT_THRESHOLD + 1, now)).toEqual(
      minutesFromNow(BASE_LOCK_MINUTES * 2),
    );
    expect(computeLockedUntil(LOCKOUT_THRESHOLD + 2, now)).toEqual(
      minutesFromNow(BASE_LOCK_MINUTES * 4),
    );
  });

  it("caps the lock duration at the maximum", () => {
    expect(computeLockedUntil(LOCKOUT_THRESHOLD + 50, now)).toEqual(
      minutesFromNow(MAX_LOCK_MINUTES),
    );
  });
});

describe("isLocked", () => {
  it("is unlocked with no lock set", () => {
    expect(isLocked(null, now)).toBe(false);
  });

  it("is locked while the expiry is in the future", () => {
    expect(isLocked(minutesFromNow(1), now)).toBe(true);
  });

  it("unlocks once the expiry has passed", () => {
    expect(isLocked(minutesFromNow(-1), now)).toBe(false);
  });
});
