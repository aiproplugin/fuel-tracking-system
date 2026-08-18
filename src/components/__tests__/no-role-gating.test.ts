import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ROLE-GATING LOCK.
 *
 * Authorization is by PERMISSION, never by role (CLAUDE.md). Roles are only
 * default bundles, so a UI control gated on `role === "ADMIN"` breaks the
 * override system in BOTH directions: a granted permission never reveals its
 * control, and a denied one keeps showing a control the server refuses.
 *
 * This test fails the build if role-based gating is reintroduced anywhere in
 * the component tree. Gate on `usePermissions().can("…")` instead.
 *
 * The allowlist below is for the legitimate uses — rendering a TARGET user's
 * role as data, and role-based page ROUTING — not for new gating. Adding an
 * entry should be a deliberate, explained decision.
 */

/** Patterns that indicate a gating decision made on the viewer's role. */
const ROLE_GATE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bisAdmin\b/, label: "isAdmin flag" },
  { pattern: /role\s*===\s*["'](ADMIN|MANAGER|SUPERVISOR|OPERATOR)["']/, label: "role equality" },
  { pattern: /role\s*!==\s*["'](ADMIN|MANAGER|SUPERVISOR|OPERATOR)["']/, label: "role inequality" },
];

/**
 * Files allowed to mention a role, with the reason. These render a role as
 * DATA about another user, or drive the role selector itself — none of them
 * decides what the VIEWER may do.
 */
const ALLOWLIST: Record<string, string> = {
  "components/admin/users/user-table.tsx":
    "shows tank assignment for TARGET users whose role is OPERATOR — data about another user, not a gate on the viewer",
  "app/page.tsx":
    "ROUTING: sends a user to their home screen by role. Not a capability gate; which landing page a multi-permission user gets is a product decision, not an access one",
  "app/home/page.tsx": "ROUTING: operator home redirects non-operators to the admin shell",
  "app/scan/page.tsx": "ROUTING: operator scanner redirects non-operators to the admin shell",
};

function collectComponentFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectComponentFiles(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

describe("UI controls are gated on permissions, not roles", () => {
  // Both trees: a page-level guard can break the override system exactly as a
  // component-level one can.
  const root = join(process.cwd(), "src");
  const files: string[] = [];
  collectComponentFiles(join(root, "components"), files);
  collectComponentFiles(join(root, "app"), files);

  it("finds the component and route trees", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const relativePath = relative(root, file).split("\\").join("/");
    const allowedReason = ALLOWLIST[relativePath];

    it(`${relativePath}${allowedReason ? " (allowlisted)" : ""}`, () => {
      const source = readFileSync(file, "utf8");
      const hits = ROLE_GATE_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
        ({ label }) => label,
      );

      if (allowedReason) {
        // Allowlisted files are EXPECTED to mention a role. If one stops doing
        // so, drop it from the list rather than leaving a stale exemption.
        expect(hits.length, `${relativePath} no longer needs its allowlist entry`).toBeGreaterThan(
          0,
        );
        return;
      }

      expect(
        hits,
        `${relativePath} gates on a role (${hits.join(", ")}). Authorization is by PERMISSION: ` +
          `use usePermissions().can("…") with the permission the server enforces, so per-user ` +
          `grants and denials actually reach the UI.`,
      ).toEqual([]);
    });
  }
});

describe("role-gating allowlist stays honest", () => {
  it("every allowlisted file still exists", () => {
    const root = join(process.cwd(), "src");
    for (const relativePath of Object.keys(ALLOWLIST)) {
      expect(() => readFileSync(join(root, relativePath), "utf8")).not.toThrow();
    }
  });

  it("documents a reason for every exemption", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});
