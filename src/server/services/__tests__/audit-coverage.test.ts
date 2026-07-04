import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Audit-coverage lock. Every `AuditAction` the schema defines must actually be
 * EMITTED somewhere in the server/app source. Deleting an audit-write call (or
 * adding an enum value nobody emits) fails this test — the audit trail cannot
 * silently lose coverage.
 */

function readEnumValues(): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const match = schema.match(/enum AuditAction \{([^}]*)\}/);
  if (!match) throw new Error("AuditAction enum not found in schema.prisma");
  return match[1]!
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

function collectSource(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSource(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(readFileSync(full, "utf8"));
    }
  }
}

describe("audit coverage lock", () => {
  const enumValues = readEnumValues();
  const files: string[] = [];
  collectSource(join(process.cwd(), "src", "server"), files);
  collectSource(join(process.cwd(), "src", "app"), files);
  const source = files.join("\n");

  it("defines a non-trivial set of audit actions", () => {
    expect(enumValues.length).toBeGreaterThan(20);
    expect(enumValues).toContain("REPORT_EXPORTED");
  });

  for (const action of readEnumValues()) {
    it(`emits ${action} somewhere in server/app source`, () => {
      // Matches `action: "X"` / `? "X" : ...` / any string-literal reference.
      expect(source.includes(`"${action}"`)).toBe(true);
    });
  }
});
