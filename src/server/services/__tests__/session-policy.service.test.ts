import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    sessionPolicy: { findMany: vi.fn(), upsert: vi.fn() },
    userSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((operations: unknown[]) => Promise.resolve(operations)),
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { updateSessionPoliciesSchema } from "@/lib/schemas/session-policy";
import {
  createUserSession,
  deleteUserSession,
  getSessionPolicies,
  invalidateSessionPolicyCache,
  pruneUserSessions,
  resolveSessionState,
  updateSessionPolicies,
} from "@/server/services/session-policy.service";

const MINUTE = 60_000;

function auditArg(index = 0) {
  return (mockDb.auditLog.create.mock.calls[index]?.[0] as { data: Record<string, unknown> }).data;
}

/** A stored session row, `idleMinutes` ago since its last request. */
function sessionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sid-1",
    userId: "user-1",
    role: "ADMIN",
    lastActivityAt: new Date(Date.now() - 1_000),
    createdAt: new Date(Date.now() - 5 * MINUTE),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.userSession.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.userSession.update.mockResolvedValue({});
  // Empty table: every role falls back to its code default.
  mockDb.sessionPolicy.findMany.mockResolvedValue([]);
  // The policy cache lives for 10s at module scope, which spans a whole test
  // file. Drop it so each test reads the policy set it just stubbed.
  invalidateSessionPolicyCache();
});

describe("getSessionPolicies", () => {
  it("falls back to code defaults when no rows exist", async () => {
    const policies = await getSessionPolicies();
    expect(policies).toEqual([
      { role: "OPERATOR", idleMinutes: null },
      { role: "SUPERVISOR", idleMinutes: 15 },
      { role: "MANAGER", idleMinutes: 15 },
      { role: "ADMIN", idleMinutes: 15 },
    ]);
  });

  it("lets stored rows override the defaults", async () => {
    mockDb.sessionPolicy.findMany.mockResolvedValue([
      { role: "ADMIN", idleMinutes: 30 },
      { role: "OPERATOR", idleMinutes: 720 },
    ]);
    const policies = await getSessionPolicies();
    expect(policies).toContainEqual({ role: "ADMIN", idleMinutes: 30 });
    expect(policies).toContainEqual({ role: "OPERATOR", idleMinutes: 720 });
    expect(policies).toContainEqual({ role: "MANAGER", idleMinutes: 15 });
  });
});

describe("updateSessionPolicies", () => {
  const validInput = {
    policies: [
      { role: "OPERATOR" as const, idleMinutes: null },
      { role: "SUPERVISOR" as const, idleMinutes: 20 },
      { role: "MANAGER" as const, idleMinutes: 15 },
      { role: "ADMIN" as const, idleMinutes: 10 },
    ],
  };

  it("upserts every role in one transaction and audits SESSION_SETTINGS_UPDATED", async () => {
    await updateSessionPolicies("admin-1", validInput);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.sessionPolicy.upsert).toHaveBeenCalledTimes(4);

    const audit = auditArg();
    expect(audit.action).toBe("SESSION_SETTINGS_UPDATED");
    expect(audit.actorId).toBe("admin-1");
    expect(audit.entityType).toBe("session_policy");
    expect(audit.before).toBeDefined();
    expect(audit.after).toBeDefined();
  });

  it("re-checks the bounds even when the schema is bypassed", async () => {
    await expect(
      updateSessionPolicies("admin-1", {
        policies: [
          { role: "OPERATOR", idleMinutes: null },
          { role: "SUPERVISOR", idleMinutes: 15 },
          { role: "MANAGER", idleMinutes: 15 },
          { role: "ADMIN", idleMinutes: 240 },
        ],
      }),
    ).rejects.toThrow(/between 5 and 120/);
    expect(mockDb.sessionPolicy.upsert).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses to make a privileged role persistent", async () => {
    await expect(
      updateSessionPolicies("admin-1", {
        policies: [
          { role: "OPERATOR", idleMinutes: null },
          { role: "SUPERVISOR", idleMinutes: null },
          { role: "MANAGER", idleMinutes: 15 },
          { role: "ADMIN", idleMinutes: 15 },
        ],
      }),
    ).rejects.toThrow(/persistent/);
    expect(mockDb.sessionPolicy.upsert).not.toHaveBeenCalled();
  });
});

describe("updateSessionPoliciesSchema — request validation", () => {
  const base = [
    { role: "OPERATOR", idleMinutes: null },
    { role: "SUPERVISOR", idleMinutes: 15 },
    { role: "MANAGER", idleMinutes: 15 },
    { role: "ADMIN", idleMinutes: 15 },
  ];

  const withAdmin = (idleMinutes: number | null) =>
    base.map((policy) => (policy.role === "ADMIN" ? { ...policy, idleMinutes } : policy));

  it("rejects a privileged timeout below 5", () => {
    expect(updateSessionPoliciesSchema.safeParse({ policies: withAdmin(4) }).success).toBe(false);
  });

  it("rejects a privileged timeout above 120", () => {
    expect(updateSessionPoliciesSchema.safeParse({ policies: withAdmin(121) }).success).toBe(false);
  });

  it("accepts the inclusive boundaries", () => {
    expect(updateSessionPoliciesSchema.safeParse({ policies: withAdmin(5) }).success).toBe(true);
    expect(updateSessionPoliciesSchema.safeParse({ policies: withAdmin(120) }).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(updateSessionPoliciesSchema.safeParse({ policies: base, sneaky: true }).success).toBe(
      false,
    );
    expect(
      updateSessionPoliciesSchema.safeParse({
        policies: [{ role: "ADMIN", idleMinutes: 15, extra: 1 }],
      }).success,
    ).toBe(false);
  });

  it("requires every role, exactly once", () => {
    expect(updateSessionPoliciesSchema.safeParse({ policies: base.slice(0, 3) }).success).toBe(
      false,
    );
    expect(updateSessionPoliciesSchema.safeParse({ policies: [...base, base[3]] }).success).toBe(
      false,
    );
  });

  it("rejects an unknown role", () => {
    expect(
      updateSessionPoliciesSchema.safeParse({
        policies: [...base, { role: "SUPERUSER", idleMinutes: 15 }],
      }).success,
    ).toBe(false);
  });
});

describe("resolveSessionState — the expiry gate", () => {
  it("accepts a privileged session just before its idle timeout", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({ lastActivityAt: new Date(Date.now() - 14 * MINUTE) }),
    );
    await expect(resolveSessionState("sid-1")).resolves.toBe("ACTIVE");
    expect(mockDb.userSession.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects and deletes a privileged session past its idle timeout", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({ lastActivityAt: new Date(Date.now() - 16 * MINUTE) }),
    );
    await expect(resolveSessionState("sid-1")).resolves.toBe("REJECTED");
    expect(mockDb.userSession.deleteMany).toHaveBeenCalledWith({ where: { id: "sid-1" } });
  });

  it("rejects a privileged session past the 12-hour absolute cap despite activity", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({
        lastActivityAt: new Date(),
        createdAt: new Date(Date.now() - 13 * 60 * MINUTE),
      }),
    );
    await expect(resolveSessionState("sid-1")).resolves.toBe("REJECTED");
  });

  it("keeps an operator session alive after a long idle gap and a browser restart", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({
        role: "OPERATOR",
        lastActivityAt: new Date(Date.now() - 3 * 24 * 60 * MINUTE),
        createdAt: new Date(Date.now() - 10 * 24 * 60 * MINUTE),
      }),
    );
    await expect(resolveSessionState("sid-1")).resolves.toBe("ACTIVE");
    expect(mockDb.userSession.deleteMany).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on an unknown sid", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(null);
    await expect(resolveSessionState("forged-sid")).resolves.toBe("REJECTED");
  });

  it("FAILS CLOSED when the lookup itself errors", async () => {
    mockDb.userSession.findUnique.mockRejectedValue(new Error("connection lost"));
    await expect(resolveSessionState("sid-1")).resolves.toBe("REJECTED");
  });

  it("resets the idle timer on activity, throttled to one write a minute", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({ lastActivityAt: new Date(Date.now() - 5 * MINUTE) }),
    );
    await resolveSessionState("sid-1");
    expect(mockDb.userSession.update).toHaveBeenCalledWith({
      where: { id: "sid-1" },
      data: { lastActivityAt: expect.any(Date) },
    });
  });

  it("skips the write for a request inside the throttle window", async () => {
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({ lastActivityAt: new Date(Date.now() - 2_000) }),
    );
    await resolveSessionState("sid-1");
    expect(mockDb.userSession.update).not.toHaveBeenCalled();
  });

  it("applies a tightened timeout to an ALREADY-ACTIVE session", async () => {
    mockDb.sessionPolicy.findMany.mockResolvedValue([{ role: "ADMIN", idleMinutes: 5 }]);
    mockDb.userSession.findUnique.mockResolvedValue(
      sessionRow({ lastActivityAt: new Date(Date.now() - 6 * MINUTE) }),
    );
    // Idle for 6 minutes: fine under the 15-minute default, expired under the
    // 5-minute policy the admin just saved.
    await expect(resolveSessionState("sid-1")).resolves.toBe("REJECTED");
  });
});

describe("session record lifecycle", () => {
  it("creates a session row stamped with the role at sign-in", async () => {
    await createUserSession({ sid: "sid-9", userId: "user-9", role: "SUPERVISOR" });
    expect(mockDb.userSession.create).toHaveBeenCalledWith({
      data: {
        id: "sid-9",
        userId: "user-9",
        role: "SUPERVISOR",
        lastActivityAt: expect.any(Date),
      },
    });
  });

  it("deletes the row on sign-out", async () => {
    await deleteUserSession("sid-9");
    expect(mockDb.userSession.deleteMany).toHaveBeenCalledWith({ where: { id: "sid-9" } });
  });

  it("prunes only rows older than the requested window", async () => {
    mockDb.userSession.deleteMany.mockResolvedValue({ count: 7 });
    await expect(pruneUserSessions(60)).resolves.toBe(7);
    const where = mockDb.userSession.deleteMany.mock.calls[0]?.[0] as {
      where: { lastActivityAt: { lt: Date } };
    };
    expect(where.where.lastActivityAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - 60 * MINUTE);
  });
});
