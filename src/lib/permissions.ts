/**
 * THE single home for the permission catalogue, the role bundles, the
 * resolver, and the security invariants.
 *
 * Authorization is permission-based, never role-based: every protected
 * procedure requires ONE permission, and a user's effective permissions are
 * resolved as a pure function of their role plus their per-user overrides.
 * Roles survive only as named DEFAULT BUNDLES — a user with no overrides
 * behaves exactly as they did under the old role gates.
 *
 * IMPORTANT: the bundles below are derived from the ACTUAL authorization
 * matrix, not from an assumed hierarchy. The roles are NOT nested:
 * SUPERVISOR may record deliveries and adjustments while MANAGER may not;
 * MANAGER may read the audit trail while SUPERVISOR may not; and fuel entry
 * is OPERATOR-only, so ADMIN deliberately does NOT hold every permission.
 * See ROLE_DEFAULTS for the per-role rationale.
 *
 * Adding a permission = one entry in PERMISSIONS + one in PERMISSION_CONFIG +
 * a decision in every ROLE_DEFAULTS bundle (completeness is unit-tested).
 *
 * String unions (no @prisma/client import) keep this module client-safe so the
 * Access Management UI can render the catalogue without pulling in Prisma.
 */

/** Mirrors the Prisma Role enum; string union keeps this module client-safe. */
export type RoleName = "OPERATOR" | "SUPERVISOR" | "MANAGER" | "ADMIN";

export const ROLES = ["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"] as const satisfies
  readonly RoleName[];

export type Permission =
  // --- Fuel entry (OPERATOR-only capabilities) ---
  | "fuel.issue"
  | "vehicle.lookup"
  | "report.view.own"
  // --- Operational reads ---
  | "dashboard.view"
  | "masterdata.view"
  | "fuelissue.view"
  | "ledger.view"
  | "quota.view"
  | "audit.view"
  // --- Reporting ---
  | "report.run"
  | "report.export"
  | "report.view.site"
  | "report.view.all"
  // --- Operational writes ---
  | "delivery.record"
  | "stock.adjust"
  | "quota.override.authorise"
  | "reconcile.run"
  // --- Administration ---
  | "exception.review"
  | "reconcile.repair"
  | "quota.manage"
  | "masterdata.manage"
  | "qrtoken.manage"
  | "user.manage"
  | "permission.manage";

/**
 * Canonical order for the catalogue UI. Literal tuple (not a widened array) so
 * z.enum() in schemas/permissions.ts consumes it directly and still infers the
 * exact union; `satisfies` keeps every entry checked against Permission.
 */
export const PERMISSIONS = [
  "fuel.issue",
  "vehicle.lookup",
  "report.view.own",
  "dashboard.view",
  "masterdata.view",
  "fuelissue.view",
  "ledger.view",
  "quota.view",
  "audit.view",
  "report.run",
  "report.export",
  "report.view.site",
  "report.view.all",
  "delivery.record",
  "stock.adjust",
  "quota.override.authorise",
  "reconcile.run",
  "exception.review",
  "reconcile.repair",
  "quota.manage",
  "masterdata.manage",
  "qrtoken.manage",
  "user.manage",
  "permission.manage",
] as const satisfies readonly Permission[];

/** Display grouping for the Access Management page. */
export type PermissionGroup = "Fuel entry" | "Operations" | "Reporting" | "Administration";

export interface PermissionConfig {
  /** Short human label. */
  label: string;
  /** What the permission actually allows, in operator language. */
  description: string;
  group: PermissionGroup;
  /**
   * True for permissions that WIDEN DATA VISIBILITY rather than unlock an
   * action. Granting one lets the holder see records belonging to sites they
   * are not assigned to, which no segregation-of-duties pair can express — the
   * UI must warn prominently before such a grant is saved.
   */
  widensDataVisibility?: true;
}

export const PERMISSION_CONFIG: Record<Permission, PermissionConfig> = {
  "fuel.issue": {
    label: "Issue fuel",
    description: "Submit fuel issues and flag meter exceptions from the bound tank.",
    group: "Fuel entry",
  },
  "vehicle.lookup": {
    label: "Look up vehicles",
    description: "Resolve a vehicle by QR token or manual token entry.",
    group: "Fuel entry",
  },
  "report.view.own": {
    label: "View own activity",
    description: "See one's own fuel issues for the day.",
    group: "Fuel entry",
  },
  "dashboard.view": {
    label: "View dashboard",
    description: "Open the operations dashboard and its KPIs.",
    group: "Operations",
  },
  "masterdata.view": {
    label: "View master data",
    description: "List companies, sites, tanks, vehicles, and vehicle types.",
    group: "Operations",
  },
  "fuelissue.view": {
    label: "View fuel issues",
    description: "List fuel issues and the meter-exception queue.",
    group: "Operations",
  },
  "ledger.view": {
    label: "View ledger activity",
    description: "List recorded deliveries and stock adjustments.",
    group: "Operations",
  },
  "quota.view": {
    label: "View quota status",
    description: "See per-vehicle quota consumption and remaining allowance.",
    group: "Operations",
  },
  "audit.view": {
    label: "View audit trail",
    description: "Read the append-only audit log.",
    group: "Operations",
  },
  "report.run": {
    label: "Run reports",
    description: "Run reports on screen and open efficiency drill-downs.",
    group: "Reporting",
  },
  "report.export": {
    label: "Export reports",
    description: "Download reports as CSV or XLSX.",
    group: "Reporting",
  },
  "report.view.site": {
    label: "See own site's data",
    description: "Report and dashboard data is limited to the user's own site.",
    group: "Reporting",
    widensDataVisibility: true,
  },
  "report.view.all": {
    label: "See ALL sites' data",
    description: "Report and dashboard data spans every site, not just the user's own.",
    group: "Reporting",
    widensDataVisibility: true,
  },
  "delivery.record": {
    label: "Record deliveries",
    description: "Book fuel deliveries into a tank (writes the stock ledger).",
    group: "Operations",
  },
  "stock.adjust": {
    label: "Adjust stock",
    description: "Record a stock adjustment against a tank (writes the stock ledger).",
    group: "Operations",
  },
  "quota.override.authorise": {
    label: "Authorise quota overrides",
    description: "Issue a one-time code letting an operator exceed a vehicle quota.",
    group: "Operations",
  },
  "reconcile.run": {
    label: "Run reconciliation",
    description: "Check cached tank stock against the append-only ledger.",
    group: "Operations",
  },
  "exception.review": {
    label: "Review meter exceptions",
    description: "Approve or reject a blocked meter reading (the only override path).",
    group: "Administration",
  },
  "reconcile.repair": {
    label: "Repair stock cache",
    description: "Rewrite a tank's cached stock to match the ledger.",
    group: "Administration",
  },
  "quota.manage": {
    label: "Manage quotas",
    description: "Configure quota settings, defaults, assignments, and top-ups.",
    group: "Administration",
  },
  "masterdata.manage": {
    label: "Manage master data",
    description: "Create and edit companies, sites, tanks, vehicles, and vehicle types.",
    group: "Administration",
  },
  "qrtoken.manage": {
    label: "Manage QR tokens",
    description: "Generate, print, rotate, and deactivate vehicle QR tokens.",
    group: "Administration",
  },
  "user.manage": {
    label: "Manage users",
    description: "Create and edit users, assign tanks, reset passwords, unlock accounts.",
    group: "Administration",
  },
  "permission.manage": {
    label: "Manage access",
    description: "Change roles and grant or deny per-user permission overrides.",
    group: "Administration",
  },
};

// ---------------------------------------------------------------------------
// Role bundles
// ---------------------------------------------------------------------------

/**
 * Default permissions per role — the EXACT equivalent of the previous role
 * gates, so a user with no overrides is unaffected by the move to permissions.
 *
 * Deliberate non-obvious facts, all verified against the authorization matrix:
 *  - MANAGER does NOT get delivery.record / stock.adjust. Those were
 *    roleProcedure(["SUPERVISOR", "ADMIN"]) — the roles are not nested.
 *  - SUPERVISOR does NOT get audit.view. That was ["MANAGER", "ADMIN"].
 *  - SUPERVISOR does NOT get exception.review: authorising a meter override is
 *    ADMIN-only by business rule, and supervisors/managers cannot override.
 *  - MANAGER does NOT get quota.manage; quota administration is ADMIN-only.
 *  - ADMIN does NOT get the OPERATOR fuel-entry set. Fuel entry requires a
 *    session-bound tank, and an ADMIN holding fuel.issue alongside
 *    stock.adjust would violate segregation of duties at the role level.
 */
export const ROLE_DEFAULTS: Record<RoleName, readonly Permission[]> = {
  OPERATOR: ["fuel.issue", "vehicle.lookup", "report.view.own"],

  SUPERVISOR: [
    "dashboard.view",
    "masterdata.view",
    "fuelissue.view",
    "ledger.view",
    "quota.view",
    "report.run",
    "report.export",
    "report.view.site",
    "delivery.record",
    "stock.adjust",
    "quota.override.authorise",
    "reconcile.run",
  ],

  MANAGER: [
    "dashboard.view",
    "masterdata.view",
    "fuelissue.view",
    "ledger.view",
    "quota.view",
    "audit.view",
    "report.run",
    "report.export",
    "report.view.all",
    "quota.override.authorise",
    "reconcile.run",
  ],

  ADMIN: [
    "dashboard.view",
    "masterdata.view",
    "fuelissue.view",
    "ledger.view",
    "quota.view",
    "audit.view",
    "report.run",
    "report.export",
    "report.view.all",
    "delivery.record",
    "stock.adjust",
    "quota.override.authorise",
    "reconcile.run",
    "exception.review",
    "reconcile.repair",
    "quota.manage",
    "masterdata.manage",
    "qrtoken.manage",
    "user.manage",
    "permission.manage",
  ],
};

// ---------------------------------------------------------------------------
// Security invariants
// ---------------------------------------------------------------------------

/**
 * SEGREGATION OF DUTIES — the system's core fraud control.
 *
 * Whoever dispenses fuel must never also be able to book the stock that hides
 * a shortfall. No role bundle contains either pair (unit-tested), and no
 * override may create one.
 */
export const MUTUALLY_EXCLUSIVE_PERMISSIONS: readonly (readonly [Permission, Permission])[] = [
  ["fuel.issue", "delivery.record"],
  ["fuel.issue", "stock.adjust"],
] as const;

/**
 * META-PERMISSIONS — grantable only by holding the ADMIN role itself, never
 * through an override. Without this, any user given permission.manage could
 * grant themselves every other permission in one step.
 */
export const ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  "user.manage",
  "permission.manage",
] as const;

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export type OverrideMode = "GRANT" | "DENY";

/** A stored override row, narrowed to what resolution needs. */
export interface PermissionOverrideInput {
  /** Catalogue key. Typed as string because the column is a string: rows
   *  predating a catalogue change must be ignored, never crash the resolver. */
  permission: string;
  mode: OverrideMode;
}

/** Type guard: is this string a live catalogue permission? */
export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * THE resolver. Effective permissions = (role defaults ∪ grants) − denials.
 *
 * DENIALS ALWAYS WIN — over grants and over the role bundle alike. Unknown
 * permission strings (a catalogue entry removed while rows remain) are
 * ignored, so a stale row can never widen access.
 *
 * Pure and total: no I/O, no clock, no exceptions.
 */
export function resolveEffectivePermissions(
  role: RoleName,
  overrides: readonly PermissionOverrideInput[] = [],
): ReadonlySet<Permission> {
  const effective = new Set<Permission>(ROLE_DEFAULTS[role]);

  for (const override of overrides) {
    if (override.mode === "GRANT" && isPermission(override.permission)) {
      effective.add(override.permission);
    }
  }
  // Second pass: denials are applied last so they beat both grants and role.
  for (const override of overrides) {
    if (override.mode === "DENY" && isPermission(override.permission)) {
      effective.delete(override.permission);
    }
  }
  return effective;
}

/** Where a permission's current state came from — drives the UI source column. */
export type PermissionSource = "role" | "granted" | "denied" | "none";

/**
 * Per-permission provenance for the Access Management page, so an effective
 * set is never ambiguous:
 *  - "role"    held because the role bundle includes it
 *  - "granted" held because of an explicit GRANT override
 *  - "denied"  NOT held because of an explicit DENY override (denials win)
 *  - "none"    NOT held; neither the role nor any override mentions it
 */
export function explainPermissions(
  role: RoleName,
  overrides: readonly PermissionOverrideInput[] = [],
): Record<Permission, PermissionSource> {
  const fromRole = new Set<Permission>(ROLE_DEFAULTS[role]);
  const granted = new Set<Permission>();
  const denied = new Set<Permission>();

  for (const override of overrides) {
    if (!isPermission(override.permission)) continue;
    if (override.mode === "GRANT") granted.add(override.permission);
    else denied.add(override.permission);
  }

  const sources = {} as Record<Permission, PermissionSource>;
  for (const permission of PERMISSIONS) {
    if (denied.has(permission)) sources[permission] = "denied";
    else if (fromRole.has(permission)) sources[permission] = "role";
    else if (granted.has(permission)) sources[permission] = "granted";
    else sources[permission] = "none";
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export type GuardrailCode =
  | "SEGREGATION_OF_DUTIES"
  | "META_PERMISSION_LOCKED"
  | "FUEL_ISSUE_REQUIRES_TANK"
  | "LAST_ADMIN_LOCKOUT";

export interface GuardrailViolation {
  code: GuardrailCode;
  /** Safe to show to an ADMIN in the Access Management UI. */
  message: string;
  /** The permissions involved, for highlighting in the UI. */
  permissions: readonly Permission[];
}

export interface OverrideValidationContext {
  /** The role the user WILL have (already includes a pending role change). */
  role: RoleName;
  /** The complete override set the user WILL have after the save. */
  overrides: readonly PermissionOverrideInput[];
  /** Whether the target user has a bound default tank. */
  hasDefaultTank: boolean;
  /** Whether this is the only remaining active ADMIN. */
  isLastActiveAdmin: boolean;
}

/**
 * Validate a PROPOSED end state against every security invariant.
 *
 * Deliberately evaluated against the RESULTING EFFECTIVE SET, not against the
 * raw grant being added. That distinction matters: denying fuel.issue and
 * granting stock.adjust in one save is legal, while granting stock.adjust to a
 * user who still holds fuel.issue is not.
 *
 * Returns the first violation, or null when the end state is safe. Pure.
 */
export function validateOverrides(context: OverrideValidationContext): GuardrailViolation | null {
  const effective = resolveEffectivePermissions(context.role, context.overrides);

  // 1. Segregation of duties — checked on the effective set, both directions.
  for (const [left, right] of MUTUALLY_EXCLUSIVE_PERMISSIONS) {
    if (effective.has(left) && effective.has(right)) {
      return {
        code: "SEGREGATION_OF_DUTIES",
        message:
          `Cannot grant "${PERMISSION_CONFIG[right].label}" (${right}): this user holds ` +
          `"${PERMISSION_CONFIG[left].label}" (${left}). One person must never both dispense ` +
          `fuel and book the stock that would conceal a shortfall — segregation of duties.`,
        permissions: [left, right],
      };
    }
  }

  // 2. Meta-permissions cannot be granted by override to a non-ADMIN.
  if (context.role !== "ADMIN") {
    for (const override of context.overrides) {
      if (
        override.mode === "GRANT" &&
        isPermission(override.permission) &&
        ADMIN_ONLY_PERMISSIONS.includes(override.permission)
      ) {
        return {
          code: "META_PERMISSION_LOCKED",
          message:
            `Cannot grant "${PERMISSION_CONFIG[override.permission].label}" ` +
            `(${override.permission}) to a ${context.role}: access-control permissions are ` +
            `reserved to the ADMIN role and cannot be granted by override. Change the ` +
            `user's role instead.`,
          permissions: [override.permission],
        };
      }
    }
  }

  // 3. Fuel entry is built on a session-bound tank; without one the flow has
  //    no tank to draw from and would fail at request time.
  if (effective.has("fuel.issue") && !context.hasDefaultTank) {
    return {
      code: "FUEL_ISSUE_REQUIRES_TANK",
      message:
        `Cannot grant "${PERMISSION_CONFIG["fuel.issue"].label}" (fuel.issue): the user has no ` +
        `assigned tank. Fuel is always issued from the operator's bound tank — assign one first.`,
      permissions: ["fuel.issue"],
    };
  }

  // 4. Never let the last active ADMIN lose the ability to administer access;
  //    the system would become permanently unadministrable.
  if (context.isLastActiveAdmin) {
    for (const locked of ADMIN_ONLY_PERMISSIONS) {
      if (!effective.has(locked)) {
        return {
          code: "LAST_ADMIN_LOCKOUT",
          message:
            `Cannot deny "${PERMISSION_CONFIG[locked].label}" (${locked}) from the last active ` +
            `administrator: no one would be able to manage access afterwards.`,
          permissions: [locked],
        };
      }
    }
  }

  return null;
}
