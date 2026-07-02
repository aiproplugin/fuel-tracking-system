import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { BASE_LOCK_MINUTES, LOCKOUT_THRESHOLD } from "@/server/auth/lockout-policy";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import { changeOwnPassword, verifyUserCredentials } from "@/server/services/user.service";

const CORRECT_PASSWORD = "Correct#Pass2026";
let passwordHash: string;

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    username: "operator1",
    passwordHash,
    displayName: "Nimal Perera",
    role: "OPERATOR",
    isActive: true,
    defaultTankId: "tank-a",
    siteId: "site-1",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    ...overrides,
  };
}

beforeAll(async () => {
  passwordHash = await hashPassword(CORRECT_PASSWORD);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.user.update.mockResolvedValue({});
  mockDb.auditLog.create.mockResolvedValue({});
});

describe("verifyUserCredentials", () => {
  it("returns the user DTO and resets counters on success", async () => {
    mockDb.user.findUnique.mockResolvedValue(makeUser({ failedLoginCount: 3 }));

    const result = await verifyUserCredentials({
      username: "Operator1", // mixed case: normalization expected
      password: CORRECT_PASSWORD,
      ipAddress: "10.0.0.5",
    });

    expect(result).toMatchObject({ id: "user-1", role: "OPERATOR", defaultTankId: "tank-a" });
    expect(mockDb.user.findUnique).toHaveBeenCalledWith({ where: { username: "operator1" } });
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      }),
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "LOGIN_SUCCESS" }) }),
    );
  });

  it("returns null for an unknown username and audits without an actor", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const result = await verifyUserCredentials({
      username: "ghost",
      password: "whatever",
      ipAddress: null,
    });

    expect(result).toBeNull();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "LOGIN_FAILURE", actorId: null }),
      }),
    );
  });

  it("increments the failure counter on a wrong password (no lock below threshold)", async () => {
    mockDb.user.findUnique.mockResolvedValue(makeUser({ failedLoginCount: 0 }));

    const result = await verifyUserCredentials({
      username: "operator1",
      password: "Wrong#Pass2026",
      ipAddress: "10.0.0.5",
    });

    expect(result).toBeNull();
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { failedLoginCount: 1, lockedUntil: null },
      }),
    );
  });

  it("locks the account at the failure threshold with the base duration", async () => {
    mockDb.user.findUnique.mockResolvedValue(makeUser({ failedLoginCount: LOCKOUT_THRESHOLD - 1 }));
    const before = Date.now();

    const result = await verifyUserCredentials({
      username: "operator1",
      password: "Wrong#Pass2026",
      ipAddress: "10.0.0.5",
    });

    expect(result).toBeNull();
    const updateArg = mockDb.user.update.mock.calls[0]?.[0] as {
      data: { failedLoginCount: number; lockedUntil: Date | null };
    };
    expect(updateArg.data.failedLoginCount).toBe(LOCKOUT_THRESHOLD);
    expect(updateArg.data.lockedUntil).toBeInstanceOf(Date);
    const lockMs = (updateArg.data.lockedUntil as Date).getTime() - before;
    expect(lockMs).toBeGreaterThan((BASE_LOCK_MINUTES - 1) * 60_000);
    expect(lockMs).toBeLessThan((BASE_LOCK_MINUTES + 1) * 60_000);

    const auditActions = mockDb.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toContain("ACCOUNT_LOCKED");
  });

  it("rejects a locked account even with the correct password", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      makeUser({
        failedLoginCount: LOCKOUT_THRESHOLD,
        lockedUntil: new Date(Date.now() + 10 * 60_000),
      }),
    );

    const result = await verifyUserCredentials({
      username: "operator1",
      password: CORRECT_PASSWORD,
      ipAddress: "10.0.0.5",
    });

    expect(result).toBeNull();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("rejects an inactive account even with the correct password", async () => {
    mockDb.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

    const result = await verifyUserCredentials({
      username: "operator1",
      password: CORRECT_PASSWORD,
      ipAddress: "10.0.0.5",
    });

    expect(result).toBeNull();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("carries the mustChangePassword flag into the session payload", async () => {
    mockDb.user.findUnique.mockResolvedValue(makeUser({ mustChangePassword: true }));

    const result = await verifyUserCredentials({
      username: "operator1",
      password: CORRECT_PASSWORD,
      ipAddress: "10.0.0.5",
    });

    expect(result?.mustChangePassword).toBe(true);
  });
});

describe("changeOwnPassword", () => {
  const NEW_PASSWORD = "Fresh!Passw0rd#2026";

  it("rejects a wrong current password without updating anything", async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "chg-wrong" }));

    await expect(
      changeOwnPassword({
        userId: "chg-wrong",
        currentPassword: "Wrong#Pass2026",
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "chg-same" }));

    await expect(
      changeOwnPassword({
        userId: "chg-same",
        currentPassword: CORRECT_PASSWORD,
        newPassword: CORRECT_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("updates the hash, clears the temporary flag, and audits PASSWORD_CHANGED", async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue(
      makeUser({ id: "chg-ok", mustChangePassword: true }),
    );

    await changeOwnPassword({
      userId: "chg-ok",
      currentPassword: CORRECT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const updateArg = mockDb.user.update.mock.calls[0]?.[0] as {
      data: { passwordHash: string; mustChangePassword: boolean };
    };
    expect(updateArg.data.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(updateArg.data.passwordHash).not.toBe(passwordHash);
    expect(updateArg.data.mustChangePassword).toBe(false);

    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as { data: { action: string } };
    expect(auditArg.data.action).toBe("PASSWORD_CHANGED");
    const payload = JSON.stringify(auditArg);
    expect(payload).not.toContain(NEW_PASSWORD);
    expect(payload).not.toContain("argon2");
  });

  it("rate-limits repeated attempts per user", async () => {
    mockDb.user.findUniqueOrThrow.mockResolvedValue(makeUser({ id: "chg-rate" }));

    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        changeOwnPassword({
          userId: "chg-rate",
          currentPassword: "Wrong#Pass2026",
          newPassword: NEW_PASSWORD,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }

    await expect(
      changeOwnPassword({
        userId: "chg-rate",
        currentPassword: CORRECT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
