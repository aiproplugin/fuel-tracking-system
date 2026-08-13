import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    userPermissionOverride: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/services/audit.service", () => ({ recordAuditEvent: vi.fn() }));

import { recordAuditEvent } from "@/server/services/audit.service";
import {
  buildActor,
  changeUserRole,
  getUserAccess,
  removePermissionOverride,
  resolveActorPermissions,
  setPermissionOverride,
} from "@/server/services/permission.service";
import { testActor } from "@/server/services/__tests__/test-actor";

const auditMock = vi.mocked(recordAuditEvent);
const admin = testActor("ADMIN", { id: "adm-1" });

const OPERATOR_ID = "11111111-1111-1111-1111-111111111111";
const SUPERVISOR_ID = "22222222-2222-2222-2222-222222222222";

/** Target user the guardrails will read facts from. */
function targetUser(overrides: Record<string, unknown> = {}) {
  return {
    id: OPERATOR_ID,
    role: "OPERATOR",
    isActive: true,
    defaultTankId: "tank-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.user.findUnique.mockResolvedValue(targetUser());
  mockDb.userPermissionOverride.findMany.mockResolvedValue([]);
  mockDb.userPermissionOverride.upsert.mockResolvedValue({});
  mockDb.userPermissionOverride.delete.mockResolvedValue({});
  mockDb.user.update.mockResolvedValue({});
  mockDb.user.count.mockResolvedValue(1); // another active admin exists
  auditMock.mockResolvedValue(undefined as never);
});

describe("resolveActorPermissions / buildActor", () => {
  it("resolves the role bundle when the user has no overrides", async () => {
    const permissions = await resolveActorPermissions(mockDb as never, OPERATOR_ID, "OPERATOR");
    expect(permissions.has("fuel.issue")).toBe(true);
    expect(permissions.has("stock.adjust")).toBe(false);
  });

  it("applies stored grants and denials", async () => {
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "audit.view", mode: "GRANT" },
      { permission: "stock.adjust", mode: "DENY" },
    ]);
    const permissions = await resolveActorPermissions(mockDb as never, SUPERVISOR_ID, "SUPERVISOR");
    expect(permissions.has("audit.view")).toBe(true);
    expect(permissions.has("stock.adjust")).toBe(false);
  });

  it("queries only the target user's rows", async () => {
    await resolveActorPermissions(mockDb as never, OPERATOR_ID, "OPERATOR");
    expect(mockDb.userPermissionOverride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: OPERATOR_ID } }),
    );
  });

  it("builds an actor carrying identity, site, tank, and permissions", async () => {
    const actor = await buildActor(mockDb as never, {
      id: OPERATOR_ID,
      role: "OPERATOR",
      siteId: "site-1",
      defaultTankId: "tank-1",
    });
    expect(actor).toMatchObject({ id: OPERATOR_ID, role: "OPERATOR", defaultTankId: "tank-1" });
    expect(actor.permissions.has("fuel.issue")).toBe(true);
  });

  it("propagates a read failure instead of falling back to the role bundle", async () => {
    mockDb.userPermissionOverride.findMany.mockRejectedValue(new Error("db down"));
    await expect(
      resolveActorPermissions(mockDb as never, OPERATOR_ID, "ADMIN"),
    ).rejects.toThrow("db down");
  });
});

describe("setPermissionOverride — guardrails are enforced at the write path", () => {
  it("refuses a grant that would breach segregation of duties", async () => {
    // Target is an OPERATOR, so already holds fuel.issue.
    await expect(
      setPermissionOverride(admin, {
        userId: OPERATOR_ID,
        permission: "stock.adjust",
        mode: "GRANT",
        reason: "cover for the supervisor",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockDb.userPermissionOverride.upsert).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("refuses delivery.record for a fuel issuer too", async () => {
    await expect(
      setPermissionOverride(admin, {
        userId: OPERATOR_ID,
        permission: "delivery.record",
        mode: "GRANT",
        reason: "holiday cover",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });

  it("refuses granting a meta-permission to a non-admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
    );
    await expect(
      setPermissionOverride(admin, {
        userId: SUPERVISOR_ID,
        permission: "user.manage",
        mode: "GRANT",
        reason: "needs to reset passwords",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.userPermissionOverride.upsert).not.toHaveBeenCalled();
  });

  it("refuses fuel.issue for a user with no bound tank", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "MANAGER", defaultTankId: null }),
    );
    await expect(
      setPermissionOverride(admin, {
        userId: SUPERVISOR_ID,
        permission: "fuel.issue",
        mode: "GRANT",
        reason: "pump cover",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to deny a meta-permission from the last active admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(targetUser({ id: "adm-2", role: "ADMIN" }));
    mockDb.user.count.mockResolvedValue(0); // no other active admin

    await expect(
      setPermissionOverride(admin, {
        userId: "adm-2",
        permission: "permission.manage",
        mode: "DENY",
        reason: "temporary lockdown",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("saves a legal grant and audits PERMISSION_GRANTED", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
    );

    await setPermissionOverride(admin, {
      userId: SUPERVISOR_ID,
      permission: "audit.view",
      mode: "GRANT",
      reason: "monthly review duty",
    });

    expect(mockDb.userPermissionOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_permission: { userId: SUPERVISOR_ID, permission: "audit.view" } },
        create: expect.objectContaining({ mode: "GRANT", grantedById: "adm-1" }),
      }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PERMISSION_GRANTED",
        actorId: "adm-1",
        entityId: SUPERVISOR_ID,
        after: expect.objectContaining({
          permission: "audit.view",
          reason: "monthly review duty",
        }),
      }),
    );
  });

  it("saves a denial and audits PERMISSION_DENIED", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
    );

    await setPermissionOverride(admin, {
      userId: SUPERVISOR_ID,
      permission: "stock.adjust",
      mode: "DENY",
      reason: "under investigation",
    });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PERMISSION_DENIED", entityId: SUPERVISOR_ID }),
    );
  });

  it("allows the conflict-free sequence: deny fuel.issue, then grant stock.adjust", async () => {
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "fuel.issue", mode: "DENY" },
    ]);

    await expect(
      setPermissionOverride(admin, {
        userId: OPERATOR_ID,
        permission: "stock.adjust",
        mode: "GRANT",
        reason: "moved to stock control",
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("removePermissionOverride", () => {
  beforeEach(() => {
    mockDb.userPermissionOverride.findUnique.mockResolvedValue({
      permission: "stock.adjust",
      mode: "DENY",
      reason: "was under investigation",
    });
  });

  it("404s when there is no such override", async () => {
    mockDb.userPermissionOverride.findUnique.mockResolvedValue(null);
    await expect(
      removePermissionOverride(admin, {
        userId: OPERATOR_ID,
        permission: "stock.adjust",
        reason: "cleanup",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a removal that would re-create a conflict", async () => {
    // Operator holds fuel.issue by role and stock.adjust by grant, currently
    // made safe by a DENY on fuel.issue. Removing that DENY re-arms the conflict.
    mockDb.userPermissionOverride.findUnique.mockResolvedValue({
      permission: "fuel.issue",
      mode: "DENY",
      reason: "moved to stock control",
    });
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "fuel.issue", mode: "DENY" },
      { permission: "stock.adjust", mode: "GRANT" },
    ]);

    await expect(
      removePermissionOverride(admin, {
        userId: OPERATOR_ID,
        permission: "fuel.issue",
        reason: "back on the pump",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockDb.userPermissionOverride.delete).not.toHaveBeenCalled();
  });

  it("removes a safe override and audits PERMISSION_OVERRIDE_REMOVED", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
    );
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "stock.adjust", mode: "DENY" },
    ]);

    await removePermissionOverride(admin, {
      userId: SUPERVISOR_ID,
      permission: "stock.adjust",
      reason: "investigation closed",
    });

    expect(mockDb.userPermissionOverride.delete).toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PERMISSION_OVERRIDE_REMOVED",
        before: expect.objectContaining({ permission: "stock.adjust", mode: "DENY" }),
      }),
    );
  });
});

describe("changeUserRole", () => {
  it("refuses a role change that creates a segregation-of-duties conflict", async () => {
    // A MANAGER granted stock.adjust, demoted to OPERATOR, would gain fuel.issue.
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "MANAGER", defaultTankId: "tank-1" }),
    );
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "stock.adjust", mode: "GRANT" },
    ]);

    await expect(
      changeUserRole(admin, { userId: SUPERVISOR_ID, role: "OPERATOR", reason: "moved to pump" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses a role change that strands a meta-permission grant on a non-admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "ADMIN", defaultTankId: null }),
    );
    mockDb.userPermissionOverride.findMany.mockResolvedValue([
      { permission: "user.manage", mode: "GRANT" },
    ]);

    await expect(
      changeUserRole(admin, { userId: SUPERVISOR_ID, role: "MANAGER", reason: "step down" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to demote the last active admin", async () => {
    mockDb.user.findUnique.mockResolvedValue(targetUser({ id: "adm-2", role: "ADMIN" }));
    mockDb.user.count.mockResolvedValue(0);

    await expect(
      changeUserRole(admin, { userId: "adm-2", role: "MANAGER", reason: "handover" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("applies a safe role change and audits ROLE_CHANGED with before/after", async () => {
    mockDb.user.findUnique.mockResolvedValue(
      targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
    );

    await changeUserRole(admin, {
      userId: SUPERVISOR_ID,
      role: "MANAGER",
      reason: "promotion",
    });

    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: SUPERVISOR_ID },
      data: { role: "MANAGER" },
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ROLE_CHANGED",
        before: { role: "SUPERVISOR" },
        after: expect.objectContaining({ role: "MANAGER", reason: "promotion" }),
      }),
    );
  });
});

describe("getUserAccess — effective set with provenance", () => {
  it("labels each permission's source and marks the held ones", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
      username: "sup",
      displayName: "Sup",
      permissionOverrides: [
        {
          permission: "audit.view",
          mode: "GRANT",
          reason: "review duty",
          createdAt: new Date("2026-08-01T00:00:00Z"),
          grantedBy: { displayName: "Root Admin" },
        },
        {
          permission: "stock.adjust",
          mode: "DENY",
          reason: "under investigation",
          createdAt: new Date("2026-08-02T00:00:00Z"),
          grantedBy: { displayName: "Root Admin" },
        },
      ],
    });

    const access = await getUserAccess(SUPERVISOR_ID);
    const by = (key: string) => access.permissions.find((row) => row.permission === key)!;

    expect(by("dashboard.view")).toMatchObject({ source: "role", held: true });
    expect(by("audit.view")).toMatchObject({ source: "granted", held: true });
    expect(by("stock.adjust")).toMatchObject({ source: "denied", held: false });
    expect(by("qrtoken.manage")).toMatchObject({ source: "none", held: false });
  });

  it("attaches the reason and author of each override", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
      username: "sup",
      displayName: "Sup",
      permissionOverrides: [
        {
          permission: "audit.view",
          mode: "GRANT",
          reason: "review duty",
          createdAt: new Date("2026-08-01T00:00:00Z"),
          grantedBy: { displayName: "Root Admin" },
        },
      ],
    });

    const access = await getUserAccess(SUPERVISOR_ID);
    const row = access.permissions.find((entry) => entry.permission === "audit.view")!;
    expect(row.override).toMatchObject({
      mode: "GRANT",
      reason: "review duty",
      grantedBy: "Root Admin",
    });
  });

  it("flags scope-widening and admin-only permissions for the UI", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      ...targetUser({ id: SUPERVISOR_ID, role: "SUPERVISOR", defaultTankId: null }),
      username: "sup",
      displayName: "Sup",
      permissionOverrides: [],
    });

    const access = await getUserAccess(SUPERVISOR_ID);
    const by = (key: string) => access.permissions.find((row) => row.permission === key)!;

    expect(by("report.view.all").widensDataVisibility).toBe(true);
    expect(by("permission.manage").adminOnly).toBe(true);
    expect(by("user.manage").adminOnly).toBe(true);
    expect(by("dashboard.view").adminOnly).toBe(false);
    expect(by("dashboard.view").widensDataVisibility).toBe(false);
  });

  it("404s for an unknown user", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    await expect(getUserAccess("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
