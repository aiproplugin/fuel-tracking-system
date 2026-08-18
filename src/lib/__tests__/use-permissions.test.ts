import { describe, expect, it } from "vitest";
import { ROLE_DEFAULTS, type Permission } from "@/lib/permissions";
import { hasPermission } from "@/lib/hooks/use-permissions";

/**
 * The client-side gating decision, tested directly.
 *
 * These cases are the bug this helper exists to prevent: UI controls were gated
 * on the BASE ROLE, so a per-user override never reached the interface — a
 * granted permission left its control hidden (making the grant useless) and a
 * denied one left the control on screen.
 */

/** What auth.me returns for a supervisor granted masterdata.manage. */
const SUPERVISOR_WITH_GRANT: Permission[] = [...ROLE_DEFAULTS.SUPERVISOR, "masterdata.manage"];

/** What auth.me returns for an admin denied masterdata.manage by override. */
const ADMIN_WITH_DENIAL: Permission[] = ROLE_DEFAULTS.ADMIN.filter(
  (permission) => permission !== "masterdata.manage",
);

describe("hasPermission — a GRANT reaches the UI", () => {
  it("a SUPERVISOR granted masterdata.manage holds it", () => {
    expect(hasPermission(SUPERVISOR_WITH_GRANT, "masterdata.manage")).toBe(true);
  });

  it("a plain SUPERVISOR does not", () => {
    expect(hasPermission([...ROLE_DEFAULTS.SUPERVISOR], "masterdata.manage")).toBe(false);
  });

  it("the grant does not leak into unrelated permissions", () => {
    expect(hasPermission(SUPERVISOR_WITH_GRANT, "user.manage")).toBe(false);
    expect(hasPermission(SUPERVISOR_WITH_GRANT, "audit.view")).toBe(false);
  });
});

describe("hasPermission — a DENIAL reaches the UI (the reverse case)", () => {
  it("an ADMIN denied masterdata.manage no longer holds it", () => {
    expect(hasPermission(ADMIN_WITH_DENIAL, "masterdata.manage")).toBe(false);
  });

  it("their other permissions are untouched", () => {
    expect(hasPermission(ADMIN_WITH_DENIAL, "user.manage")).toBe(true);
    expect(hasPermission(ADMIN_WITH_DENIAL, "quota.manage")).toBe(true);
  });
});

describe("hasPermission — fails closed", () => {
  it("treats a not-yet-loaded permission set as holding nothing", () => {
    expect(hasPermission(undefined, "masterdata.manage")).toBe(false);
    expect(hasPermission(null, "masterdata.manage")).toBe(false);
    expect(hasPermission([], "masterdata.manage")).toBe(false);
  });
});

describe("role defaults still decide the un-overridden case", () => {
  // Proof the change is behaviour-preserving for users with no overrides:
  // exactly the roles that used to see each control still do.
  const CONTROL_PERMISSIONS = {
    "master data (add/edit/delete)": "masterdata.manage",
    "record delivery": "delivery.record",
    "record adjustment": "stock.adjust",
    "review meter exception": "exception.review",
    "manage quotas / top-up": "quota.manage",
    "issue override code": "quota.override.authorise",
    "site filter": "report.view.all",
  } as const satisfies Record<string, Permission>;

  const EXPECTED_ROLES: Record<keyof typeof CONTROL_PERMISSIONS, string[]> = {
    "master data (add/edit/delete)": ["ADMIN"],
    "record delivery": ["ADMIN", "SUPERVISOR"],
    "record adjustment": ["ADMIN", "SUPERVISOR"],
    "review meter exception": ["ADMIN"],
    "manage quotas / top-up": ["ADMIN"],
    "issue override code": ["ADMIN", "MANAGER", "SUPERVISOR"],
    "site filter": ["ADMIN", "MANAGER"],
  };

  for (const [control, permission] of Object.entries(CONTROL_PERMISSIONS)) {
    it(`${control}: unchanged for users without overrides`, () => {
      const roles = (["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"] as const).filter((role) =>
        hasPermission([...ROLE_DEFAULTS[role]], permission),
      );
      expect([...roles].sort()).toEqual(
        [...EXPECTED_ROLES[control as keyof typeof CONTROL_PERMISSIONS]].sort(),
      );
    });
  }
});
