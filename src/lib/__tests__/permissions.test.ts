import { describe, expect, it } from "vitest";
import {
  ADMIN_ONLY_PERMISSIONS,
  MUTUALLY_EXCLUSIVE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_CONFIG,
  ROLES,
  ROLE_DEFAULTS,
  explainPermissions,
  isPermission,
  resolveEffectivePermissions,
  validateOverrides,
  type OverrideValidationContext,
  type Permission,
} from "@/lib/permissions";

/** Convenience: build a validation context with safe defaults. */
function context(overrides: Partial<OverrideValidationContext> = {}): OverrideValidationContext {
  return {
    role: "SUPERVISOR",
    overrides: [],
    hasDefaultTank: false,
    isLastActiveAdmin: false,
    ...overrides,
  };
}

const grant = (permission: string) => ({ permission, mode: "GRANT" as const });
const deny = (permission: string) => ({ permission, mode: "DENY" as const });

describe("permission catalogue completeness", () => {
  it("has a full config entry for every permission", () => {
    for (const permission of PERMISSIONS) {
      const config = PERMISSION_CONFIG[permission];
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.description.length).toBeGreaterThan(0);
      expect(config.group.length).toBeGreaterThan(0);
    }
  });

  it("lists every configured permission exactly once", () => {
    const configured = Object.keys(PERMISSION_CONFIG) as Permission[];
    expect([...PERMISSIONS].sort()).toEqual(configured.sort());
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("defines a bundle for every role, drawn only from the catalogue", () => {
    for (const role of ROLES) {
      const bundle = ROLE_DEFAULTS[role];
      expect(bundle.length).toBeGreaterThan(0);
      expect(new Set(bundle).size).toBe(bundle.length); // no duplicates
      for (const permission of bundle) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it("recognises catalogue keys and rejects anything else", () => {
    expect(isPermission("fuel.issue")).toBe(true);
    expect(isPermission("fuel.issues")).toBe(false);
    expect(isPermission("")).toBe(false);
    expect(isPermission("__proto__")).toBe(false);
  });
});

describe("role bundles match the pre-RBAC authorization matrix", () => {
  // These assertions encode the behaviour the old role gates produced. If one
  // fails, the migration to permissions has CHANGED who can do what.
  it("keeps fuel entry OPERATOR-only", () => {
    for (const role of ["SUPERVISOR", "MANAGER", "ADMIN"] as const) {
      expect(ROLE_DEFAULTS[role]).not.toContain("fuel.issue");
      expect(ROLE_DEFAULTS[role]).not.toContain("vehicle.lookup");
    }
    expect(ROLE_DEFAULTS.OPERATOR).toContain("fuel.issue");
  });

  it("keeps deliveries and adjustments with SUPERVISOR and ADMIN, NOT MANAGER", () => {
    // roleProcedure(["SUPERVISOR", "ADMIN"]) — the roles are not nested.
    for (const permission of ["delivery.record", "stock.adjust"] as const) {
      expect(ROLE_DEFAULTS.SUPERVISOR).toContain(permission);
      expect(ROLE_DEFAULTS.ADMIN).toContain(permission);
      expect(ROLE_DEFAULTS.MANAGER).not.toContain(permission);
    }
  });

  it("keeps the audit trail with MANAGER and ADMIN, NOT SUPERVISOR", () => {
    expect(ROLE_DEFAULTS.MANAGER).toContain("audit.view");
    expect(ROLE_DEFAULTS.ADMIN).toContain("audit.view");
    expect(ROLE_DEFAULTS.SUPERVISOR).not.toContain("audit.view");
  });

  it("keeps meter-exception review ADMIN-only", () => {
    expect(ROLE_DEFAULTS.ADMIN).toContain("exception.review");
    expect(ROLE_DEFAULTS.SUPERVISOR).not.toContain("exception.review");
    expect(ROLE_DEFAULTS.MANAGER).not.toContain("exception.review");
  });

  it("keeps quota administration ADMIN-only while quota override stays supervisor-up", () => {
    expect(ROLE_DEFAULTS.ADMIN).toContain("quota.manage");
    expect(ROLE_DEFAULTS.MANAGER).not.toContain("quota.manage");
    expect(ROLE_DEFAULTS.SUPERVISOR).not.toContain("quota.manage");
    for (const role of ["SUPERVISOR", "MANAGER", "ADMIN"] as const) {
      expect(ROLE_DEFAULTS[role]).toContain("quota.override.authorise");
    }
  });

  it("scopes report visibility per role exactly as before", () => {
    expect(ROLE_DEFAULTS.SUPERVISOR).toContain("report.view.site");
    expect(ROLE_DEFAULTS.SUPERVISOR).not.toContain("report.view.all");
    expect(ROLE_DEFAULTS.MANAGER).toContain("report.view.all");
    expect(ROLE_DEFAULTS.ADMIN).toContain("report.view.all");
  });

  it("gives ADMIN every permission except OPERATOR fuel entry and the narrower scope", () => {
    // report.view.site is the NARROWER alternative to report.view.all, not an
    // extra capability: scope resolves all > site > own, so holding both would
    // be redundant and would muddy what the permission means.
    const notForAdmin: Permission[] = [
      "fuel.issue",
      "vehicle.lookup",
      "report.view.own",
      "report.view.site",
    ];
    const expected = PERMISSIONS.filter((p) => !notForAdmin.includes(p));
    expect([...ROLE_DEFAULTS.ADMIN].sort()).toEqual([...expected].sort());
  });

  it("gives every role exactly one report-scope permission", () => {
    const scopes: Permission[] = ["report.view.own", "report.view.site", "report.view.all"];
    for (const role of ROLES) {
      const held = scopes.filter((scope) => ROLE_DEFAULTS[role].includes(scope));
      expect(held).toHaveLength(1);
    }
  });
});

describe("SECURITY INVARIANT: no role bundle violates segregation of duties", () => {
  // If this fails, the default bundles themselves are unsafe and no override
  // validation can save the system.
  for (const role of ROLES) {
    it(`${role}'s default bundle holds no mutually-exclusive pair`, () => {
      const held = new Set<Permission>(ROLE_DEFAULTS[role]);
      for (const [left, right] of MUTUALLY_EXCLUSIVE_PERMISSIONS) {
        expect(held.has(left) && held.has(right)).toBe(false);
      }
    });
  }

  it("keeps meta-permissions out of every non-ADMIN bundle", () => {
    for (const role of ["OPERATOR", "SUPERVISOR", "MANAGER"] as const) {
      for (const locked of ADMIN_ONLY_PERMISSIONS) {
        expect(ROLE_DEFAULTS[role]).not.toContain(locked);
      }
    }
  });
});

describe("resolveEffectivePermissions", () => {
  it("returns exactly the role bundle when there are no overrides", () => {
    for (const role of ROLES) {
      const effective = resolveEffectivePermissions(role, []);
      expect([...effective].sort()).toEqual([...ROLE_DEFAULTS[role]].sort());
    }
  });

  it("defaults to no overrides when the argument is omitted", () => {
    expect([...resolveEffectivePermissions("OPERATOR")].sort()).toEqual(
      [...ROLE_DEFAULTS.OPERATOR].sort(),
    );
  });

  it("adds a granted permission the role does not have", () => {
    const effective = resolveEffectivePermissions("MANAGER", [grant("stock.adjust")]);
    expect(effective.has("stock.adjust")).toBe(true);
    expect(effective.has("dashboard.view")).toBe(true); // role permissions survive
  });

  it("removes a denied permission the role does have", () => {
    const effective = resolveEffectivePermissions("SUPERVISOR", [deny("stock.adjust")]);
    expect(effective.has("stock.adjust")).toBe(false);
    expect(ROLE_DEFAULTS.SUPERVISOR).toContain("stock.adjust");
  });

  it("DENIALS WIN over a grant of the same permission", () => {
    const effective = resolveEffectivePermissions("MANAGER", [
      grant("stock.adjust"),
      deny("stock.adjust"),
    ]);
    expect(effective.has("stock.adjust")).toBe(false);
  });

  it("DENIALS WIN regardless of override ordering", () => {
    const effective = resolveEffectivePermissions("MANAGER", [
      deny("stock.adjust"),
      grant("stock.adjust"),
    ]);
    expect(effective.has("stock.adjust")).toBe(false);
  });

  it("denies a permission held by role even when also granted", () => {
    const effective = resolveEffectivePermissions("ADMIN", [
      grant("qrtoken.manage"),
      deny("qrtoken.manage"),
    ]);
    expect(effective.has("qrtoken.manage")).toBe(false);
  });

  it("ignores unknown permission strings in both directions", () => {
    const effective = resolveEffectivePermissions("OPERATOR", [
      grant("fuel.superpower"),
      deny("does.not.exist"),
    ]);
    expect([...effective].sort()).toEqual([...ROLE_DEFAULTS.OPERATOR].sort());
  });

  it("is pure: repeated calls with the same input agree and do not mutate the bundle", () => {
    const before = [...ROLE_DEFAULTS.SUPERVISOR];
    const first = resolveEffectivePermissions("SUPERVISOR", [grant("audit.view")]);
    const second = resolveEffectivePermissions("SUPERVISOR", [grant("audit.view")]);
    expect([...first].sort()).toEqual([...second].sort());
    expect([...ROLE_DEFAULTS.SUPERVISOR]).toEqual(before);
  });
});

describe("explainPermissions", () => {
  it("labels every catalogue permission with a source", () => {
    const sources = explainPermissions("SUPERVISOR", []);
    expect(Object.keys(sources).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("reports role, granted, denied, and none distinctly", () => {
    const sources = explainPermissions("SUPERVISOR", [
      grant("audit.view"),
      deny("stock.adjust"),
    ]);
    expect(sources["dashboard.view"]).toBe("role"); // from the bundle
    expect(sources["audit.view"]).toBe("granted"); // added by override
    expect(sources["stock.adjust"]).toBe("denied"); // removed despite the role
    expect(sources["qrtoken.manage"]).toBe("none"); // never held
  });

  it("reports 'denied' even when the same permission is also granted", () => {
    const sources = explainPermissions("MANAGER", [grant("stock.adjust"), deny("stock.adjust")]);
    expect(sources["stock.adjust"]).toBe("denied");
  });

  it("agrees with the resolver: exactly role|granted are the effective set", () => {
    const overrides = [grant("audit.view"), deny("stock.adjust"), grant("qrtoken.manage")];
    const sources = explainPermissions("SUPERVISOR", overrides);
    const effective = resolveEffectivePermissions("SUPERVISOR", overrides);
    for (const permission of PERMISSIONS) {
      const held = sources[permission] === "role" || sources[permission] === "granted";
      expect(held).toBe(effective.has(permission));
    }
  });

  it("ignores unknown keys rather than inventing a source", () => {
    const sources = explainPermissions("OPERATOR", [grant("nope.nope")]);
    expect(Object.keys(sources)).not.toContain("nope.nope");
  });
});

describe("GUARDRAIL: segregation of duties", () => {
  it("rejects granting delivery.record to a user holding fuel.issue", () => {
    const violation = validateOverrides(
      context({ role: "OPERATOR", hasDefaultTank: true, overrides: [grant("delivery.record")] }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
    expect(violation?.message).toContain("segregation of duties");
    expect(violation?.permissions).toContain("delivery.record");
  });

  it("rejects granting stock.adjust to a user holding fuel.issue", () => {
    const violation = validateOverrides(
      context({ role: "OPERATOR", hasDefaultTank: true, overrides: [grant("stock.adjust")] }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
    expect(violation?.permissions).toContain("stock.adjust");
  });

  it("rejects the reverse direction: granting fuel.issue to a user holding stock.adjust", () => {
    const violation = validateOverrides(
      context({ role: "SUPERVISOR", hasDefaultTank: true, overrides: [grant("fuel.issue")] }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
  });

  it("rejects granting fuel.issue to a user holding delivery.record", () => {
    const violation = validateOverrides(
      context({
        role: "MANAGER",
        hasDefaultTank: true,
        overrides: [grant("delivery.record"), grant("fuel.issue")],
      }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
  });

  it("rejects assembling BOTH sides by override on a role that has neither", () => {
    const violation = validateOverrides(
      context({
        role: "MANAGER",
        hasDefaultTank: true,
        overrides: [grant("fuel.issue"), grant("stock.adjust")],
      }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
  });

  it("ALLOWS the conflict-free path: deny fuel.issue, then grant stock.adjust", () => {
    // The invariant is about the EFFECTIVE set, not the raw grant.
    const violation = validateOverrides(
      context({
        role: "OPERATOR",
        hasDefaultTank: true,
        overrides: [deny("fuel.issue"), grant("stock.adjust")],
      }),
    );
    expect(violation).toBeNull();
  });

  it("ALLOWS granting delivery.record once fuel.issue is denied", () => {
    const violation = validateOverrides(
      context({
        role: "OPERATOR",
        hasDefaultTank: true,
        overrides: [deny("fuel.issue"), grant("delivery.record")],
      }),
    );
    expect(violation).toBeNull();
  });

  it("permits every untouched role bundle", () => {
    for (const role of ROLES) {
      const violation = validateOverrides(
        context({ role, hasDefaultTank: true, isLastActiveAdmin: role === "ADMIN" }),
      );
      expect(violation).toBeNull();
    }
  });
});

describe("GUARDRAIL: meta-permissions are locked to the ADMIN role", () => {
  for (const locked of ADMIN_ONLY_PERMISSIONS) {
    for (const role of ["OPERATOR", "SUPERVISOR", "MANAGER"] as const) {
      it(`rejects granting ${locked} to a ${role}`, () => {
        const violation = validateOverrides(
          context({ role, hasDefaultTank: true, overrides: [grant(locked)] }),
        );
        expect(violation?.code).toBe("META_PERMISSION_LOCKED");
        expect(violation?.permissions).toContain(locked);
      });
    }
  }

  it("blocks the privilege-escalation path (self-granting user.manage as MANAGER)", () => {
    // A manager with permission.manage trying to award themselves user.manage
    // and then escalate must be stopped at the override-validation layer.
    const violation = validateOverrides(
      context({
        role: "MANAGER",
        hasDefaultTank: true,
        overrides: [grant("permission.manage"), grant("user.manage")],
      }),
    );
    expect(violation?.code).toBe("META_PERMISSION_LOCKED");
  });

  it("allows an ADMIN to hold them (they come from the role, not an override)", () => {
    const violation = validateOverrides(
      context({ role: "ADMIN", hasDefaultTank: true, isLastActiveAdmin: true }),
    );
    expect(violation).toBeNull();
  });

  it("does not block DENYING a meta-permission from a non-last admin", () => {
    const violation = validateOverrides(
      context({ role: "ADMIN", hasDefaultTank: true, overrides: [deny("user.manage")] }),
    );
    expect(violation).toBeNull();
  });
});

describe("GUARDRAIL: fuel issuers need a bound tank", () => {
  it("rejects fuel.issue for a user with no default tank", () => {
    const violation = validateOverrides(
      context({ role: "OPERATOR", hasDefaultTank: false }),
    );
    expect(violation?.code).toBe("FUEL_ISSUE_REQUIRES_TANK");
    expect(violation?.permissions).toContain("fuel.issue");
  });

  it("rejects granting fuel.issue to a tankless MANAGER", () => {
    const violation = validateOverrides(
      context({ role: "MANAGER", hasDefaultTank: false, overrides: [grant("fuel.issue")] }),
    );
    expect(violation?.code).toBe("FUEL_ISSUE_REQUIRES_TANK");
  });

  it("accepts fuel.issue once a tank is bound", () => {
    expect(validateOverrides(context({ role: "OPERATOR", hasDefaultTank: true }))).toBeNull();
  });

  it("accepts a tankless operator whose fuel.issue is denied", () => {
    const violation = validateOverrides(
      context({ role: "OPERATOR", hasDefaultTank: false, overrides: [deny("fuel.issue")] }),
    );
    expect(violation).toBeNull();
  });
});

describe("GUARDRAIL: the last active admin cannot be locked out", () => {
  for (const locked of ADMIN_ONLY_PERMISSIONS) {
    it(`rejects denying ${locked} from the last active ADMIN`, () => {
      const violation = validateOverrides(
        context({
          role: "ADMIN",
          hasDefaultTank: true,
          isLastActiveAdmin: true,
          overrides: [deny(locked)],
        }),
      );
      expect(violation?.code).toBe("LAST_ADMIN_LOCKOUT");
      expect(violation?.permissions).toContain(locked);
    });
  }

  it("allows the same denial when another active ADMIN remains", () => {
    const violation = validateOverrides(
      context({
        role: "ADMIN",
        hasDefaultTank: true,
        isLastActiveAdmin: false,
        overrides: [deny("permission.manage")],
      }),
    );
    expect(violation).toBeNull();
  });
});

describe("GUARDRAIL: role changes are re-validated against existing overrides", () => {
  it("rejects demoting a stock.adjust holder to OPERATOR (gains fuel.issue)", () => {
    // The override is untouched; the ROLE CHANGE is what creates the conflict.
    const violation = validateOverrides(
      context({
        role: "OPERATOR",
        hasDefaultTank: true,
        overrides: [grant("stock.adjust")],
      }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
  });

  it("rejects promoting a fuel.issue holder to SUPERVISOR (gains stock.adjust)", () => {
    const violation = validateOverrides(
      context({
        role: "SUPERVISOR",
        hasDefaultTank: true,
        overrides: [grant("fuel.issue")],
      }),
    );
    expect(violation?.code).toBe("SEGREGATION_OF_DUTIES");
  });

  it("rejects a role change that strands a meta-permission override on a non-admin", () => {
    const violation = validateOverrides(
      context({ role: "MANAGER", hasDefaultTank: true, overrides: [grant("user.manage")] }),
    );
    expect(violation?.code).toBe("META_PERMISSION_LOCKED");
  });
});
