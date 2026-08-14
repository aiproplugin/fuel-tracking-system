import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_CONFIG,
  adjustmentReasonLabel,
  type AdjustmentReasonName,
} from "@/lib/adjustment-reason";

/**
 * ADJUSTMENT_REASON_CONFIG is the ONLY home of category labels, helper text,
 * and chip variants — these tests guard its completeness (adding a Prisma
 * AdjustmentReason value without a config entry fails to compile, and fails
 * here at runtime too) and pin the exact display strings.
 */

function schemaEnumValues(): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const match = schema.match(/enum AdjustmentReason \{([^}]*)\}/);
  if (!match) throw new Error("AdjustmentReason enum not found in schema.prisma");
  return (
    match[1]!
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//"))
      // Values carry a trailing `// what it means` comment in the schema.
      .map((line) => line.split("//")[0]!.trim())
  );
}

describe("ADJUSTMENT_REASON_CONFIG completeness", () => {
  it("has a full config entry for every category", () => {
    for (const reason of ADJUSTMENT_REASONS) {
      const config = ADJUSTMENT_REASON_CONFIG[reason];
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.shortLabel.length).toBeGreaterThan(0);
      expect(config.helper.length).toBeGreaterThan(0);
      expect(config.badgeVariant.length).toBeGreaterThan(0);
    }
  });

  it("lists every configured category exactly once in ADJUSTMENT_REASONS", () => {
    const configured = Object.keys(ADJUSTMENT_REASON_CONFIG) as AdjustmentReasonName[];
    expect([...ADJUSTMENT_REASONS].sort()).toEqual(configured.sort());
    expect(new Set(ADJUSTMENT_REASONS).size).toBe(ADJUSTMENT_REASONS.length);
  });

  // The lock that keeps the DB and the config module in step: a category added
  // to Prisma but not configured (or vice versa) fails here.
  it("matches the Prisma AdjustmentReason enum exactly", () => {
    expect(schemaEnumValues().sort()).toEqual([...ADJUSTMENT_REASONS].sort());
  });

  it("gives each category a distinct chip variant so they never read alike", () => {
    const variants = ADJUSTMENT_REASONS.map(
      (reason) => ADJUSTMENT_REASON_CONFIG[reason].badgeVariant,
    );
    expect(new Set(variants).size).toBe(ADJUSTMENT_REASONS.length);
  });

  it("pins the display labels and helper text", () => {
    expect(adjustmentReasonLabel("UNAUTHORIZED_EXTRACTION")).toBe(
      "Unauthorized Extraction (Suspected Theft)",
    );
    expect(adjustmentReasonLabel("DISPENSING_INACCURACY")).toBe("Dispensing Inaccuracy");
    expect(adjustmentReasonLabel("LEAK_OR_SPILL")).toBe("Leak or Spill");
    expect(adjustmentReasonLabel("EVAPORATION_OR_SLUDGE")).toBe("Evaporation or Sludge");

    expect(ADJUSTMENT_REASON_CONFIG.LEAK_OR_SPILL.helper).toBe(
      "Faulty nozzles, pipe corrosion, hose damage, overfill during delivery",
    );
    expect(ADJUSTMENT_REASON_CONFIG.EVAPORATION_OR_SLUDGE.helper).toBe(
      "Temperature/condensation loss, tank-bottom sediment accumulation",
    );
  });

  it("marks suspected theft as the one danger-coloured category", () => {
    expect(ADJUSTMENT_REASON_CONFIG.UNAUTHORIZED_EXTRACTION.badgeVariant).toBe("danger");
  });
});
