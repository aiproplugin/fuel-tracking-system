import type { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Import the WHOLE router tree, so this matrix covers every real procedure
// (dashboard, reports, fuel, admin, …) — not a synthetic stand-in.
// The DB is stubbed apart from the override lookup the permission middleware
// performs: allowed calls fall through the gate and fail later on a missing db
// method (a non-authz error), which is exactly what we assert.
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    userPermissionOverride: {
      findMany: vi.fn<() => Promise<Array<{ permission: string; mode: "GRANT" | "DENY" }>>>(() =>
        Promise.resolve([]),
      ),
    },
  },
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { createRequestLogger } from "@/lib/logger";
import {
  PERMISSIONS,
  ROLE_DEFAULTS,
  validateOverrides,
  type Permission,
} from "@/lib/permissions";
import { appRouter, createCaller } from "@/server/api/root";
import type { TRPCContext } from "@/server/api/trpc";

/**
 * Declared authorization for EVERY procedure. This doubles as a lock: the test
 * asserts these keys equal the router's actual procedure set, so a newly added
 * procedure fails the build until its required access is declared here.
 *
 * The `roles` sets are the PRE-RBAC role gates, kept verbatim. Access is now
 * decided by permissions, so these sets are also DERIVED independently from
 * the required permission and ROLE_DEFAULTS, and the two must agree — that
 * cross-check is what proves the move to permissions changed nobody's access.
 */
type Access =
  | { kind: "public" } // no auth at all
  | { kind: "authed" } // any authenticated role
  | { kind: "roles"; roles: readonly Role[]; permission: Permission };

const R =
  (...roles: Role[]) =>
  (permission: Permission): Access => ({ kind: "roles", roles, permission });

const SUPERVISOR_UP = R("SUPERVISOR", "MANAGER", "ADMIN");
const MANAGER_UP = R("MANAGER", "ADMIN");
const SUPERVISOR_ADMIN = R("SUPERVISOR", "ADMIN");
const ADMIN_ONLY = R("ADMIN");
const OPERATOR_ONLY = R("OPERATOR");

const EXPECTED: Record<string, Access> = {
  "health.status": { kind: "public" },

  "auth.me": { kind: "authed" },
  "auth.changePassword": { kind: "authed" },

  "dashboard.summary": SUPERVISOR_UP("dashboard.view"),

  "fuelIssues.lookupVehicle": OPERATOR_ONLY("vehicle.lookup"),
  "fuelIssues.submit": OPERATOR_ONLY("fuel.issue"),
  "fuelIssues.flagException": OPERATOR_ONLY("fuel.issue"),
  "fuelIssues.myDay": OPERATOR_ONLY("report.view.own"),
  "fuelIssues.list": SUPERVISOR_UP("fuelissue.view"),
  "fuelIssues.exceptions": SUPERVISOR_UP("fuelissue.view"),
  "fuelIssues.reviewException": ADMIN_ONLY("exception.review"),

  "deliveries.create": SUPERVISOR_ADMIN("delivery.record"),
  "deliveries.list": SUPERVISOR_UP("ledger.view"),

  "adjustments.create": SUPERVISOR_ADMIN("stock.adjust"),
  "adjustments.list": SUPERVISOR_UP("ledger.view"),

  "reconciliation.run": SUPERVISOR_UP("reconcile.run"),
  "reconciliation.repair": ADMIN_ONLY("reconcile.repair"),

  "reports.available": SUPERVISOR_UP("report.run"),
  "reports.run": SUPERVISOR_UP("report.run"),
  "reports.vehicleDetail": SUPERVISOR_UP("report.run"),

  "companies.list": SUPERVISOR_UP("masterdata.view"),
  "companies.create": ADMIN_ONLY("masterdata.manage"),
  "companies.update": ADMIN_ONLY("masterdata.manage"),
  "companies.delete": ADMIN_ONLY("masterdata.manage"),

  "quotas.getSettings": ADMIN_ONLY("quota.manage"),
  "quotas.updateSettings": ADMIN_ONLY("quota.manage"),
  "quotas.setCompanyQuota": ADMIN_ONLY("quota.manage"),
  "quotas.setVehicleTypeQuota": ADMIN_ONLY("quota.manage"),
  "quotas.setVehicleQuota": ADMIN_ONLY("quota.manage"),
  "quotas.bulkAssign": ADMIN_ONLY("quota.manage"),
  "quotas.grantTopUp": ADMIN_ONLY("quota.manage"),
  "quotas.issueOverrideCode": SUPERVISOR_UP("quota.override.authorise"),
  "quotas.status": SUPERVISOR_UP("quota.view"),
  "quotas.resolveVehicle": ADMIN_ONLY("quota.manage"),

  "sites.list": SUPERVISOR_UP("masterdata.view"),
  "sites.create": ADMIN_ONLY("masterdata.manage"),
  "sites.update": ADMIN_ONLY("masterdata.manage"),
  "sites.delete": ADMIN_ONLY("masterdata.manage"),

  "tanks.list": SUPERVISOR_UP("masterdata.view"),
  "tanks.stockSummary": SUPERVISOR_UP("masterdata.view"),
  "tanks.create": ADMIN_ONLY("masterdata.manage"),
  "tanks.update": ADMIN_ONLY("masterdata.manage"),

  "vehicles.list": SUPERVISOR_UP("masterdata.view"),
  "vehicles.create": ADMIN_ONLY("masterdata.manage"),
  "vehicles.update": ADMIN_ONLY("masterdata.manage"),

  "vehicleTypes.list": SUPERVISOR_UP("masterdata.view"),
  "vehicleTypes.upsert": ADMIN_ONLY("masterdata.manage"),

  "users.list": ADMIN_ONLY("user.manage"),
  "users.create": ADMIN_ONLY("user.manage"),
  "users.update": ADMIN_ONLY("user.manage"),
  "users.assignTank": ADMIN_ONLY("user.manage"),
  "users.resetPassword": ADMIN_ONLY("user.manage"),
  "users.unlock": ADMIN_ONLY("user.manage"),

  "qrTokens.list": ADMIN_ONLY("qrtoken.manage"),
  "qrTokens.create": ADMIN_ONLY("qrtoken.manage"),
  "qrTokens.rotate": ADMIN_ONLY("qrtoken.manage"),
  "qrTokens.deactivate": ADMIN_ONLY("qrtoken.manage"),
  "qrTokens.printData": ADMIN_ONLY("qrtoken.manage"),

  "audit.list": MANAGER_UP("audit.view"),

  "permissions.listUsers": ADMIN_ONLY("permission.manage"),
  "permissions.userAccess": ADMIN_ONLY("permission.manage"),
  "permissions.setOverride": ADMIN_ONLY("permission.manage"),
  "permissions.removeOverride": ADMIN_ONLY("permission.manage"),
  "permissions.changeRole": ADMIN_ONLY("permission.manage"),
};

const ALL_ROLES: readonly Role[] = ["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"];

function contextFor(role: Role | null): TRPCContext {
  return {
    session: role
      ? {
          user: {
            id: "user-1",
            username: "tester",
            displayName: "Tester",
            role,
            // Fuel entry needs a bound tank; the guardrails guarantee one
            // wherever fuel.issue is held.
            defaultTankId: role === "OPERATOR" ? "tank-1" : null,
            siteId: null,
            mustChangePassword: false,
          },
          expires: new Date(Date.now() + 60_000).toISOString(),
        }
      : null,
    // The permission middleware resolves overrides from ctx.db on every call;
    // everything else on the client stays stubbed so an ALLOWED call falls
    // through the gate and fails later on a missing method, not on authz.
    db: mockDb as unknown as TRPCContext["db"],
    headers: new Headers(),
    logger: createRequestLogger("authz-matrix"),
    correlationId: "authz-matrix",
  };
}

function isAllowed(access: Access, role: Role | null): boolean {
  if (access.kind === "public") return true;
  if (role === null) return false;
  if (access.kind === "authed") return true;
  return access.roles.includes(role);
}

/** Invoke a procedure by dotted path and report the tRPC error code (or a marker). */
async function callCode(caller: unknown, path: string): Promise<string> {
  const fn = path.split(".").reduce<any>((node, key) => node?.[key], caller);
  try {
    await fn(undefined);
    return "OK";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "NON_TRPC_ERROR";
  }
}

describe("permission model preserves the pre-RBAC role matrix", () => {
  // THE proof that behaviour is unchanged on deploy: for every procedure, the
  // set of roles whose DEFAULT bundle contains the required permission is
  // exactly the role allowlist the procedure used to carry.
  for (const [path, access] of Object.entries(EXPECTED)) {
    if (access.kind !== "roles") continue;

    it(`${path}: roles holding ${access.permission} by default == its old allowlist`, () => {
      const rolesWithPermission = ALL_ROLES.filter((role) =>
        ROLE_DEFAULTS[role].includes(access.permission),
      );
      expect([...rolesWithPermission].sort()).toEqual([...access.roles].sort());
    });
  }

  it("uses only catalogue permissions", () => {
    for (const access of Object.values(EXPECTED)) {
      if (access.kind !== "roles") continue;
      expect(PERMISSIONS).toContain(access.permission);
    }
  });
});

describe("authorization matrix (every appRouter procedure)", () => {
  it("locks the procedure set: declared table == real router", () => {
    const actual = Object.keys(
      (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
    ).sort();
    const declared = Object.keys(EXPECTED).sort();
    // If this fails, a procedure was added/removed without updating EXPECTED —
    // declare its required access above.
    expect(actual).toEqual(declared);
  });

  for (const [path, access] of Object.entries(EXPECTED)) {
    for (const role of [null, ...ALL_ROLES] as const) {
      const allowed = isAllowed(access, role);
      const label = role ?? "anonymous";

      it(`${path} — ${label} is ${allowed ? "allowed" : "denied"}`, async () => {
        const caller = createCaller(contextFor(role));
        const code = await callCode(caller, path);

        if (allowed) {
          // Must clear the auth gate. It may then fail on the stubbed db or on
          // input validation — anything EXCEPT an authz rejection.
          expect(code).not.toBe("UNAUTHORIZED");
          expect(code).not.toBe("FORBIDDEN");
        } else if (role === null) {
          expect(code).toBe("UNAUTHORIZED");
        } else {
          expect(code).toBe("FORBIDDEN");
        }
      });
    }
  }
});

describe("per-user overrides change real access at the router", () => {
  /** Point the stubbed override lookup at a specific row set. */
  function withOverrides(rows: Array<{ permission: string; mode: "GRANT" | "DENY" }>) {
    mockDb.userPermissionOverride.findMany.mockResolvedValue(rows);
  }

  it("a GRANT lets a SUPERVISOR reach an audit procedure their role denies", async () => {
    withOverrides([{ permission: "audit.view", mode: "GRANT" }]);
    const caller = createCaller(contextFor("SUPERVISOR"));
    const code = await callCode(caller, "audit.list");
    expect(code).not.toBe("FORBIDDEN");
  });

  it("a DENY blocks an ADMIN from a procedure their role allows", async () => {
    withOverrides([{ permission: "masterdata.manage", mode: "DENY" }]);
    const caller = createCaller(contextFor("ADMIN"));
    expect(await callCode(caller, "tanks.create")).toBe("FORBIDDEN");
    // …while an untouched permission still works.
    expect(await callCode(caller, "tanks.list")).not.toBe("FORBIDDEN");
  });

  it("a DENY of a meta-permission locks an ADMIN out of access management", async () => {
    withOverrides([{ permission: "permission.manage", mode: "DENY" }]);
    const caller = createCaller(contextFor("ADMIN"));
    expect(await callCode(caller, "permissions.listUsers")).toBe("FORBIDDEN");
  });

  it("a DENY beats a GRANT of the same permission", async () => {
    withOverrides([
      { permission: "audit.view", mode: "GRANT" },
      { permission: "audit.view", mode: "DENY" },
    ]);
    const caller = createCaller(contextFor("SUPERVISOR"));
    expect(await callCode(caller, "audit.list")).toBe("FORBIDDEN");
  });
});

describe("SEGREGATION OF DUTIES cannot be assembled through the API", () => {
  // The router-level proof of the invariant: no override set that would let one
  // principal both issue fuel and write the stock ledger can ever be saved, so
  // the pairing below is unreachable in practice. Here we assert the validator
  // that every write path funnels through refuses it.
  const conflicts: Array<[string, string]> = [
    ["fuel.issue", "stock.adjust"],
    ["fuel.issue", "delivery.record"],
  ];

  for (const [held, attempted] of conflicts) {
    it(`refuses to place ${held} and ${attempted} on one user`, () => {
      const violation = validateOverrides({
        role: "OPERATOR", // already holds fuel.issue by default
        overrides: [{ permission: attempted, mode: "GRANT" }],
        hasDefaultTank: true,
        isLastActiveAdmin: false,
      });
      expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
    });

    it(`refuses the reverse: granting ${held} to a holder of ${attempted}`, () => {
      const violation = validateOverrides({
        role: "SUPERVISOR", // already holds delivery.record and stock.adjust
        overrides: [{ permission: held, mode: "GRANT" }],
        hasDefaultTank: true,
        isLastActiveAdmin: false,
      });
      expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
    });
  }

  it("no role's default bundle can reach both sides of a conflict", () => {
    for (const role of ALL_ROLES) {
      const held = new Set(ROLE_DEFAULTS[role]);
      for (const [left, right] of conflicts) {
        expect(held.has(left as Permission) && held.has(right as Permission)).toBe(false);
      }
    }
  });
});
