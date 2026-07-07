import type { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

// Import the WHOLE router tree, so this matrix covers every real procedure
// (dashboard, reports, fuel, admin, …) — not a synthetic stand-in.
// The DB is stubbed: allowed calls fall through the gate and fail later on a
// missing db method (a non-authz error), which is exactly what we assert.
vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { createRequestLogger } from "@/lib/logger";
import { appRouter, createCaller } from "@/server/api/root";
import type { TRPCContext } from "@/server/api/trpc";

/**
 * Declared authorization for EVERY procedure. This doubles as a lock: the test
 * asserts these keys equal the router's actual procedure set, so a newly added
 * procedure fails the build until its required access is declared here.
 */
type Access =
  | { kind: "public" } // no auth at all
  | { kind: "authed" } // any authenticated role
  | { kind: "roles"; roles: readonly Role[] };

const R = (...roles: Role[]): Access => ({ kind: "roles", roles });
const SUPERVISOR_UP = R("SUPERVISOR", "MANAGER", "ADMIN");
const ADMIN_ONLY = R("ADMIN");

const EXPECTED: Record<string, Access> = {
  "health.status": { kind: "public" },

  "auth.me": { kind: "authed" },
  "auth.changePassword": { kind: "authed" },

  "dashboard.summary": SUPERVISOR_UP,

  "fuelIssues.lookupVehicle": R("OPERATOR"),
  "fuelIssues.submit": R("OPERATOR"),
  "fuelIssues.flagException": R("OPERATOR"),
  "fuelIssues.myDay": R("OPERATOR"),
  "fuelIssues.list": SUPERVISOR_UP,
  "fuelIssues.exceptions": SUPERVISOR_UP,
  "fuelIssues.reviewException": ADMIN_ONLY,

  "deliveries.create": R("SUPERVISOR", "ADMIN"),
  "deliveries.list": SUPERVISOR_UP,

  "adjustments.create": R("SUPERVISOR", "ADMIN"),
  "adjustments.list": SUPERVISOR_UP,

  "reconciliation.run": SUPERVISOR_UP,
  "reconciliation.repair": ADMIN_ONLY,

  "reports.available": SUPERVISOR_UP,
  "reports.run": SUPERVISOR_UP,
  "reports.vehicleDetail": SUPERVISOR_UP,

  "sites.list": SUPERVISOR_UP,
  "sites.create": ADMIN_ONLY,
  "sites.update": ADMIN_ONLY,
  "sites.delete": ADMIN_ONLY,

  "tanks.list": SUPERVISOR_UP,
  "tanks.stockSummary": SUPERVISOR_UP,
  "tanks.create": ADMIN_ONLY,
  "tanks.update": ADMIN_ONLY,

  "vehicles.list": SUPERVISOR_UP,
  "vehicles.create": ADMIN_ONLY,
  "vehicles.update": ADMIN_ONLY,

  "vehicleTypes.list": SUPERVISOR_UP,
  "vehicleTypes.upsert": ADMIN_ONLY,

  "users.list": ADMIN_ONLY,
  "users.create": ADMIN_ONLY,
  "users.update": ADMIN_ONLY,
  "users.assignTank": ADMIN_ONLY,
  "users.resetPassword": ADMIN_ONLY,
  "users.unlock": ADMIN_ONLY,

  "qrTokens.list": ADMIN_ONLY,
  "qrTokens.create": ADMIN_ONLY,
  "qrTokens.rotate": ADMIN_ONLY,
  "qrTokens.deactivate": ADMIN_ONLY,
  "qrTokens.printData": ADMIN_ONLY,

  "audit.list": R("MANAGER", "ADMIN"),
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
            defaultTankId: null,
            siteId: null,
            mustChangePassword: false,
          },
          expires: new Date(Date.now() + 60_000).toISOString(),
        }
      : null,
    db: {} as TRPCContext["db"],
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
