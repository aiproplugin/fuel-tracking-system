import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/server/security/rate-limit";

describe("createRateLimiter", () => {
  it("allows attempts up to the limit and blocks the next one", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.consume("key", now).allowed).toBe(true);
    expect(limiter.consume("key", now + 1).allowed).toBe(true);
    expect(limiter.consume("key", now + 2).allowed).toBe(true);

    const blocked = limiter.consume("key", now + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.consume("alice", now).allowed).toBe(true);
    expect(limiter.consume("bob", now).allowed).toBe(true);
    expect(limiter.consume("alice", now + 1).allowed).toBe(false);
  });

  it("allows again once old hits slide out of the window", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const now = 1_000_000;

    limiter.consume("key", now);
    limiter.consume("key", now + 1);
    expect(limiter.consume("key", now + 2).allowed).toBe(false);

    expect(limiter.consume("key", now + 60_001).allowed).toBe(true);
  });

  it("reports remaining attempts", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const now = 1_000_000;

    expect(limiter.consume("key", now).remaining).toBe(2);
    expect(limiter.consume("key", now + 1).remaining).toBe(1);
    expect(limiter.consume("key", now + 2).remaining).toBe(0);
  });
});
