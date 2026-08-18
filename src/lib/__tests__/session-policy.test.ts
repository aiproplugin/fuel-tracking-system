import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLES, type RoleName } from "@/lib/permissions";
import {
  ACTIVITY_WRITE_THROTTLE_SECONDS,
  SESSION_POLICY_CONFIG,
  defaultSessionPolicies,
  evaluateSession,
  sessionCookieMode,
  validateIdleMinutes,
} from "@/lib/session-policy";

/** Roles whose sessions must die on browser close and inside the 5–120 band. */
const PRIVILEGED_ROLES: RoleName[] = ["SUPERVISOR", "MANAGER", "ADMIN"];

const MINUTE = 60_000;
const AT = (iso: string) => new Date(iso);

describe("session policy catalogue", () => {
  it("covers every role in ROLES", () => {
    expect(Object.keys(SESSION_POLICY_CONFIG).sort()).toEqual([...ROLES].sort());
  });

  it("matches the Role enum in schema.prisma", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
    const match = schema.match(/enum Role \{([^}]*)\}/);
    const enumValues = (match?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"));
    expect(enumValues.sort()).toEqual(Object.keys(SESSION_POLICY_CONFIG).sort());
  });

  it("ships the required defaults: operator persistent, privileged 15 minutes", () => {
    const defaults = defaultSessionPolicies();
    expect(defaults.OPERATOR).toBeNull();
    for (const role of PRIVILEGED_ROLES) {
      expect(defaults[role]).toBe(15);
    }
  });

  it("bounds privileged roles to 5–120 minutes and forbids persistent", () => {
    for (const role of PRIVILEGED_ROLES) {
      const config = SESSION_POLICY_CONFIG[role];
      expect(config.minIdleMinutes).toBe(5);
      expect(config.maxIdleMinutes).toBe(120);
      expect(config.persistentAllowed).toBe(false);
    }
  });

  it("gives privileged roles a browser-session cookie and the operator a persistent one", () => {
    expect(sessionCookieMode("OPERATOR")).toBe("PERSISTENT");
    for (const role of PRIVILEGED_ROLES) {
      expect(sessionCookieMode(role)).toBe("BROWSER_SESSION");
    }
  });

  it("caps privileged sessions at 12 hours and exempts the operator", () => {
    expect(SESSION_POLICY_CONFIG.OPERATOR.absoluteMaxMinutes).toBeNull();
    for (const role of PRIVILEGED_ROLES) {
      expect(SESSION_POLICY_CONFIG[role].absoluteMaxMinutes).toBe(12 * 60);
    }
  });
});

describe("validateIdleMinutes — server-side bounds", () => {
  for (const role of PRIVILEGED_ROLES) {
    it(`${role}: rejects below 5`, () => {
      expect(validateIdleMinutes(role, 4)).toContain("between 5 and 120");
      expect(validateIdleMinutes(role, 0)).not.toBeNull();
      expect(validateIdleMinutes(role, -10)).not.toBeNull();
    });

    it(`${role}: rejects above 120`, () => {
      expect(validateIdleMinutes(role, 121)).toContain("between 5 and 120");
      expect(validateIdleMinutes(role, 100_000)).not.toBeNull();
    });

    it(`${role}: accepts the inclusive boundaries and the middle`, () => {
      expect(validateIdleMinutes(role, 5)).toBeNull();
      expect(validateIdleMinutes(role, 15)).toBeNull();
      expect(validateIdleMinutes(role, 120)).toBeNull();
    });

    it(`${role}: refuses to disable the control with a persistent session`, () => {
      expect(validateIdleMinutes(role, null)).toContain("persistent");
    });

    it(`${role}: rejects fractional minutes`, () => {
      expect(validateIdleMinutes(role, 15.5)).not.toBeNull();
    });
  }

  it("OPERATOR: allows persistent and a long idle value", () => {
    expect(validateIdleMinutes("OPERATOR", null)).toBeNull();
    expect(validateIdleMinutes("OPERATOR", 720)).toBeNull();
    expect(validateIdleMinutes("OPERATOR", 30 * 24 * 60)).toBeNull();
  });

  it("OPERATOR: still rejects nonsense values", () => {
    expect(validateIdleMinutes("OPERATOR", 4)).not.toBeNull();
    expect(validateIdleMinutes("OPERATOR", 30 * 24 * 60 + 1)).not.toBeNull();
  });
});

describe("evaluateSession — idle expiry", () => {
  const createdAt = AT("2026-08-18T08:00:00Z");

  it("is ACTIVE just before the configured idle timeout", () => {
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 15,
      createdAt,
      lastActivityAt: AT("2026-08-18T09:00:00Z"),
      now: new Date(AT("2026-08-18T09:00:00Z").getTime() + 15 * MINUTE - 1_000),
    });
    expect(result.verdict).toBe("ACTIVE");
  });

  it("is IDLE_EXPIRED at the configured idle timeout", () => {
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 15,
      createdAt,
      lastActivityAt: AT("2026-08-18T09:00:00Z"),
      now: new Date(AT("2026-08-18T09:00:00Z").getTime() + 15 * MINUTE),
    });
    expect(result.verdict).toBe("IDLE_EXPIRED");
  });

  it("honours a CHANGED timeout against the existing session's last activity", () => {
    // 12 minutes idle: alive under the old 15-minute policy...
    const lastActivityAt = AT("2026-08-18T09:00:00Z");
    const now = new Date(lastActivityAt.getTime() + 12 * MINUTE);
    expect(
      evaluateSession({ role: "ADMIN", idleMinutes: 15, createdAt, lastActivityAt, now }).verdict,
    ).toBe("ACTIVE");
    // ...and expired the moment an admin tightens it to 10, on the next request.
    expect(
      evaluateSession({ role: "ADMIN", idleMinutes: 10, createdAt, lastActivityAt, now }).verdict,
    ).toBe("IDLE_EXPIRED");
  });

  it("never idle-expires a persistent operator session, however long the gap", () => {
    const result = evaluateSession({
      role: "OPERATOR",
      idleMinutes: null,
      createdAt,
      lastActivityAt: createdAt,
      now: new Date(createdAt.getTime() + 90 * 24 * 60 * MINUTE),
    });
    expect(result.verdict).toBe("ACTIVE");
  });
});

describe("evaluateSession — absolute cap", () => {
  it("expires a privileged session 12 hours after sign-in despite constant activity", () => {
    const createdAt = AT("2026-08-18T08:00:00Z");
    const now = new Date(createdAt.getTime() + 12 * 60 * MINUTE);
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 120,
      createdAt,
      lastActivityAt: now, // active this very second
      now,
    });
    expect(result.verdict).toBe("ABSOLUTE_EXPIRED");
  });

  it("is still ACTIVE one minute before the cap", () => {
    const createdAt = AT("2026-08-18T08:00:00Z");
    const now = new Date(createdAt.getTime() + (12 * 60 - 1) * MINUTE);
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 120,
      createdAt,
      lastActivityAt: now,
      now,
    });
    expect(result.verdict).toBe("ACTIVE");
  });

  it("takes precedence over idle when both have passed", () => {
    const createdAt = AT("2026-08-18T08:00:00Z");
    const result = evaluateSession({
      role: "MANAGER",
      idleMinutes: 15,
      createdAt,
      lastActivityAt: createdAt,
      now: new Date(createdAt.getTime() + 20 * 60 * MINUTE),
    });
    expect(result.verdict).toBe("ABSOLUTE_EXPIRED");
  });

  it("never applies an absolute cap to an operator", () => {
    const createdAt = AT("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 200 * 24 * 60 * MINUTE);
    const result = evaluateSession({
      role: "OPERATOR",
      idleMinutes: null,
      createdAt,
      lastActivityAt: now,
      now,
    });
    expect(result.verdict).toBe("ACTIVE");
  });
});

describe("evaluateSession — activity write throttle", () => {
  const createdAt = AT("2026-08-18T08:00:00Z");
  const lastActivityAt = AT("2026-08-18T09:00:00Z");

  it("skips the write for a request inside the throttle window", () => {
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 15,
      createdAt,
      lastActivityAt,
      now: new Date(lastActivityAt.getTime() + (ACTIVITY_WRITE_THROTTLE_SECONDS - 1) * 1_000),
    });
    expect(result).toEqual({ verdict: "ACTIVE", shouldTouch: false });
  });

  it("writes once the throttle window has passed", () => {
    const result = evaluateSession({
      role: "ADMIN",
      idleMinutes: 15,
      createdAt,
      lastActivityAt,
      now: new Date(lastActivityAt.getTime() + ACTIVITY_WRITE_THROTTLE_SECONDS * 1_000),
    });
    expect(result).toEqual({ verdict: "ACTIVE", shouldTouch: true });
  });
});
