import type { Role } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { createRequestLogger } from "@/lib/logger";
import {
  adminProcedure,
  createCallerFactory,
  createTRPCRouter,
  managerProcedure,
  protectedProcedure,
  roleProcedure,
  type TRPCContext,
} from "@/server/api/trpc";

const testRouter = createTRPCRouter({
  whoami: protectedProcedure.query(({ ctx }) => ctx.session.user.username),
  adminOnly: adminProcedure.query(() => "admin-granted"),
  managerUp: managerProcedure.query(() => "manager-granted"),
  adjustments: roleProcedure(["SUPERVISOR", "ADMIN"]).query(() => "adjustment-granted"),
});

const createTestCaller = createCallerFactory(testRouter);

function contextFor(role: Role | null): TRPCContext {
  return {
    session: role
      ? {
          user: {
            id: "user-1",
            username: "testuser",
            displayName: "Test User",
            role,
            defaultTankId: null,
            siteId: null,
          },
          expires: new Date(Date.now() + 60_000).toISOString(),
        }
      : null,
    db: {} as TRPCContext["db"],
    headers: new Headers(),
    logger: createRequestLogger("test"),
    correlationId: "test",
  };
}

describe("authorization middleware", () => {
  it("rejects unauthenticated calls with UNAUTHORIZED", async () => {
    const caller = createTestCaller(contextFor(null));
    await expect(caller.whoami()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("blocks an OPERATOR from an ADMIN-only procedure", async () => {
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.adminOnly()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an ADMIN through the ADMIN-only gate", async () => {
    const caller = createTestCaller(contextFor("ADMIN"));
    await expect(caller.adminOnly()).resolves.toBe("admin-granted");
  });

  it("blocks an OPERATOR from a MANAGER-level procedure", async () => {
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.managerUp()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("uses explicit allowlists: MANAGER is NOT allowed on adjustments", async () => {
    const managerCaller = createTestCaller(contextFor("MANAGER"));
    await expect(managerCaller.adjustments()).rejects.toMatchObject({ code: "FORBIDDEN" });

    const supervisorCaller = createTestCaller(contextFor("SUPERVISOR"));
    await expect(supervisorCaller.adjustments()).resolves.toBe("adjustment-granted");
  });

  it("lets any authenticated role read its own session", async () => {
    const caller = createTestCaller(contextFor("OPERATOR"));
    await expect(caller.whoami()).resolves.toBe("testuser");
  });
});
