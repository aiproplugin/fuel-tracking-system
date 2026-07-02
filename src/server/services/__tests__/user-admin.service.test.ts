import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    tank: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));

import {
  assignTank,
  createUser,
  resetPassword,
  updateUser,
} from "@/server/services/user-admin.service";

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.user.update.mockResolvedValue({});
});

describe("createUser", () => {
  it("stores the username lowercased and audits USER_CREATED without the password", async () => {
    mockDb.user.create.mockResolvedValue({ id: "u-new", username: "newop", role: "OPERATOR" });

    await createUser("admin-1", {
      username: "NewOp",
      password: "Str0ng!Passw0rd#2026",
      displayName: "New Operator",
      role: "OPERATOR",
      siteId: null,
    });

    const createArg = mockDb.user.create.mock.calls[0]?.[0] as {
      data: { username: string; passwordHash: string; mustChangePassword: boolean };
    };
    expect(createArg.data.username).toBe("newop");
    expect(createArg.data.passwordHash.startsWith("$argon2id$")).toBe(true);
    // Admin-set passwords are always temporary.
    expect(createArg.data.mustChangePassword).toBe(true);

    const auditActions = mockDb.auditLog.create.mock.calls.map(
      (call) => (call[0] as { data: { action: string } }).data.action,
    );
    expect(auditActions).toEqual(["USER_CREATED", "PASSWORD_SET"]);
    for (const call of mockDb.auditLog.create.mock.calls) {
      const payload = JSON.stringify(call[0]);
      expect(payload).not.toContain("Str0ng");
      expect(payload).not.toContain("argon2");
    }
  });
});

describe("resetPassword", () => {
  it("sets a temporary password, forces change, clears lockout, audits PASSWORD_RESET", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u-1", username: "operator1" });

    await resetPassword("admin-1", { userId: "u-1", newPassword: "New!TempPass2026" });

    const updateArg = mockDb.user.update.mock.calls[0]?.[0] as {
      data: {
        passwordHash: string;
        mustChangePassword: boolean;
        failedLoginCount: number;
        lockedUntil: null;
      };
    };
    expect(updateArg.data.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(updateArg.data.mustChangePassword).toBe(true);
    expect(updateArg.data.failedLoginCount).toBe(0);
    expect(updateArg.data.lockedUntil).toBeNull();

    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string };
    };
    expect(auditArg.data.action).toBe("PASSWORD_RESET");
    // The temporary password and its hash never enter the audit payload.
    const payload = JSON.stringify(auditArg);
    expect(payload).not.toContain("New!TempPass2026");
    expect(payload).not.toContain("argon2");
  });

  it("rejects unknown users", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    await expect(
      resetPassword("admin-1", { userId: "ghost", newPassword: "New!TempPass2026" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("updateUser — last-admin protection", () => {
  it("blocks demoting the last active admin", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      isActive: true,
      siteId: null,
    });
    mockDb.user.count.mockResolvedValue(0); // no other active admins

    await expect(
      updateUser("admin-1", {
        id: "admin-1",
        displayName: "System Administrator",
        role: "MANAGER",
        siteId: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("allows demotion when another active admin exists, audited as ROLE_CHANGED", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "admin-2",
      role: "ADMIN",
      isActive: true,
      siteId: null,
    });
    mockDb.user.count.mockResolvedValue(1);

    await updateUser("admin-1", {
      id: "admin-2",
      displayName: "Second Admin",
      role: "MANAGER",
      siteId: null,
      isActive: true,
    });

    expect(mockDb.user.update).toHaveBeenCalled();
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "ROLE_CHANGED" }) }),
    );
  });

  it("clears the tank binding when an operator changes role", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "op-1",
      role: "OPERATOR",
      isActive: true,
      siteId: "site-1",
    });

    await updateUser("admin-1", {
      id: "op-1",
      displayName: "Promoted Operator",
      role: "SUPERVISOR",
      siteId: "site-1",
      isActive: true,
    });

    const updateArg = mockDb.user.update.mock.calls[0]?.[0] as {
      data: { defaultTankId?: string | null };
    };
    expect(updateArg.data.defaultTankId).toBeNull();
  });
});

describe("assignTank", () => {
  it("rejects assignment to non-operators", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "mgr-1",
      role: "MANAGER",
      defaultTankId: null,
      defaultTank: null,
    });

    await expect(
      assignTank("admin-1", { userId: "mgr-1", tankId: "tank-1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects inactive tanks", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "op-1",
      role: "OPERATOR",
      defaultTankId: null,
      defaultTank: null,
    });
    mockDb.tank.findUnique.mockResolvedValue({ id: "tank-1", isActive: false });

    await expect(assignTank("admin-1", { userId: "op-1", tankId: "tank-1" })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("assigns and audits TANK_ASSIGNED with before/after", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "op-1",
      role: "OPERATOR",
      defaultTankId: "tank-old",
      defaultTank: { id: "tank-old", name: "Tank A" },
    });
    mockDb.tank.findUnique.mockResolvedValue({ id: "tank-new", name: "Tank B", isActive: true });

    await assignTank("admin-1", { userId: "op-1", tankId: "tank-new" });

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultTankId: "tank-new" } }),
    );
    const auditArg = mockDb.auditLog.create.mock.calls[0]?.[0] as {
      data: { action: string; before: { tankName: string }; after: { tankName: string } };
    };
    expect(auditArg.data.action).toBe("TANK_ASSIGNED");
    expect(auditArg.data.before.tankName).toBe("Tank A");
    expect(auditArg.data.after.tankName).toBe("Tank B");
  });

  it("allows clearing the binding (tankId null)", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "op-1",
      role: "OPERATOR",
      defaultTankId: "tank-old",
      defaultTank: { id: "tank-old", name: "Tank A" },
    });

    await assignTank("admin-1", { userId: "op-1", tankId: null });

    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultTankId: null } }),
    );
  });
});
