import type { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: { userPermissionOverride: { findMany: vi.fn() } },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { createRequestLogger } from "@/lib/logger";
import {
  createCallerFactory,
  createTRPCRouter,
  permissionProcedure,
  protectedProcedure,
  type TRPCContext,
} from "@/server/api/trpc";

const testRouter = createTRPCRouter({
  whoami: protectedProcedure.query(({ ctx }) => ctx.session.user.username),
  manageUsers: permissionProcedure("user.manage").query(() => "user-manage-granted"),
  readAudit: permissionProcedure("audit.view").query(() => "audit-granted"),
  adjustStock: permissionProcedure("stock.adjust").query(() => "adjustment-granted"),
  issueFuel: permissionProcedure("fuel.issue").query(({ ctx }) => ctx.actor.defaultTankId),
});

const createTestCaller = createCallerFactory(testRouter);

/** No overrides = the user's effective set is exactly their role bundle. */
function noOverrides() {
  mockDb.userPermissionOverride.findMany.mockResolvedValue([]);
}

/** Model a user carrying explicit overrides. */
function withOverrides(rows: Array<{ permission: string; mode: "GRANT" | "DENY" }>) {
  mockDb.userPermissionOverride.findMany.mockResolvedValue(rows);
}

function contextFor(role: Role | null, mustChangePassword = false): TRPCContext {
  return {
    session: role
      ? {
          user: {
            id: "user-1",
            username: "testuser",
            displayName: "Test User",
            role,
            defaultTankId: role === "OPERATOR" ? "tank-1" : null,
            siteId: null,
            mustChangePassword,
          },
          expires: new Date(Date.now() + 60_000).toISOString(),
        }
      : null,
    db: mockDb as unknown as TRPCContext["db"],
    headers: new Headers(),
    logger: createRequestLogger("test"),
    correlationId: "test",
  };
}

describe("authorization middleware — role defaults (unchanged behaviour)", () => {
  it("rejects unauthenticated calls with UNAUTHORIZED", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor(null));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks an OPERATOR from an admin-permission procedure", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.manageUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an ADMIN through", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor("ADMIN"));
    await expect(caller.manageUsers()).resolves.toBe("user-manage-granted");
  });

  it("keeps stock adjustment with SUPERVISOR, NOT MANAGER (roles are not nested)", async () => {
    noOverrides();
    const manager = createTestCaller(contextFor("MANAGER"));
    await expect(manager.adjustStock()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const supervisor = createTestCaller(contextFor("SUPERVISOR"));
    await expect(supervisor.adjustStock()).resolves.toBe("adjustment-granted");
  });

  it("keeps the audit trail with MANAGER, NOT SUPERVISOR", async () => {
    noOverrides();
    const supervisor = createTestCaller(contextFor("SUPERVISOR"));
    await expect(supervisor.readAudit()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const manager = createTestCaller(contextFor("MANAGER"));
    await expect(manager.readAudit()).resolves.toBe("audit-granted");
  });

  it("lets any authenticated role read its own session", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.whoami()).resolves.toBe("testuser");
  });

  it("blocks sessions carrying a temporary password on protected procedures", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor("ADMIN", true));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.manageUsers()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("authorization middleware — per-user overrides", () => {
  it("a GRANT opens a procedure the role alone does not allow", async () => {
    withOverrides([{ permission: "audit.view", mode: "GRANT" }]);
    const caller = createTestCaller(contextFor("SUPERVISOR"));
    await expect(caller.readAudit()).resolves.toBe("audit-granted");
  });

  it("a DENY closes a procedure the role does allow", async () => {
    withOverrides([{ permission: "stock.adjust", mode: "DENY" }]);
    const caller = createTestCaller(contextFor("SUPERVISOR"));
    await expect(caller.adjustStock()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a DENY beats a GRANT of the same permission at the gate", async () => {
    withOverrides([
      { permission: "audit.view", mode: "GRANT" },
      { permission: "audit.view", mode: "DENY" },
    ]);
    const caller = createTestCaller(contextFor("SUPERVISOR"));
    await expect(caller.readAudit()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an unknown permission string grants nothing", async () => {
    withOverrides([{ permission: "audit.view.everything", mode: "GRANT" }]);
    const caller = createTestCaller(contextFor("SUPERVISOR"));
    await expect(caller.readAudit()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resolves permissions on EVERY call, so a revocation applies immediately", async () => {
    const caller = createTestCaller(contextFor("SUPERVISOR"));

    withOverrides([{ permission: "audit.view", mode: "GRANT" }]);
    await expect(caller.readAudit()).resolves.toBe("audit-granted");

    // Same session, permission revoked between requests — no re-login needed.
    withOverrides([{ permission: "audit.view", mode: "DENY" }]);
    await expect(caller.readAudit()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("injects the resolved actor, carrying the bound tank, into the procedure", async () => {
    noOverrides();
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.issueFuel()).resolves.toBe("tank-1");
  });

  it("FAILS CLOSED when the override rows cannot be read", async () => {
    mockDb.userPermissionOverride.findMany.mockRejectedValue(new Error("db down"));
    const caller = createTestCaller(contextFor("ADMIN"));
    // Never silently falls back to the role bundle.
    await expect(caller.manageUsers()).rejects.toThrow();
  });
});
