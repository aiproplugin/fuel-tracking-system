import { describe, expect, it } from "vitest";
import { ADJUSTMENT_REASONS } from "@/lib/adjustment-reason";
import { createAdjustmentSchema, createDeliverySchema } from "@/lib/schemas/stock";

const TANK_ID = "3f0a72c1-58cc-4e7a-9d21-0a2f6f5f9b11";
const KEY = "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55";

describe("createDeliverySchema", () => {
  const valid = {
    tankId: TANK_ID,
    idempotencyKey: KEY,
    liters: 500,
    deliveredAt: new Date(),
  };

  it("accepts a valid delivery and coerces ISO strings to dates", () => {
    expect(createDeliverySchema.safeParse(valid).success).toBe(true);
    expect(
      createDeliverySchema.safeParse({ ...valid, deliveredAt: new Date().toISOString() }).success,
    ).toBe(true);
  });

  it("rejects future delivery times", () => {
    const future = new Date(Date.now() + 24 * 3_600_000);
    expect(createDeliverySchema.safeParse({ ...valid, deliveredAt: future }).success).toBe(false);
  });

  it("rejects backdating beyond 31 days", () => {
    const tooOld = new Date(Date.now() - 40 * 24 * 3_600_000);
    expect(createDeliverySchema.safeParse({ ...valid, deliveredAt: tooOld }).success).toBe(false);
  });

  it("rejects non-positive liters and unknown fields", () => {
    expect(createDeliverySchema.safeParse({ ...valid, liters: 0 }).success).toBe(false);
    expect(createDeliverySchema.safeParse({ ...valid, unitCost: 100 }).success).toBe(false);
  });
});

describe("createAdjustmentSchema", () => {
  const valid = {
    tankId: TANK_ID,
    idempotencyKey: KEY,
    quantityChange: -25,
    reasonCategory: "LEAK_OR_SPILL",
    reason: "Physical dip reading below ledger.",
  };

  it("accepts signed changes in both directions", () => {
    expect(createAdjustmentSchema.safeParse(valid).success).toBe(true);
    expect(createAdjustmentSchema.safeParse({ ...valid, quantityChange: 25 }).success).toBe(true);
  });

  it("rejects a zero change", () => {
    expect(createAdjustmentSchema.safeParse({ ...valid, quantityChange: 0 }).success).toBe(false);
  });

  it("demands a meaningful reason", () => {
    expect(createAdjustmentSchema.safeParse({ ...valid, reason: "ok" }).success).toBe(false);
  });

  // The category is REQUIRED server-side — the dropdown is not the gate.
  it("rejects an adjustment with no reason category", () => {
    const { reasonCategory: _omitted, ...withoutCategory } = valid;
    expect(createAdjustmentSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it("rejects an empty or unknown reason category", () => {
    expect(createAdjustmentSchema.safeParse({ ...valid, reasonCategory: "" }).success).toBe(false);
    expect(createAdjustmentSchema.safeParse({ ...valid, reasonCategory: null }).success).toBe(
      false,
    );
    expect(
      createAdjustmentSchema.safeParse({ ...valid, reasonCategory: "SOMETHING_ELSE" }).success,
    ).toBe(false);
  });

  it("accepts every configured category, and still demands the detail with one", () => {
    for (const category of ADJUSTMENT_REASONS) {
      expect(createAdjustmentSchema.safeParse({ ...valid, reasonCategory: category }).success).toBe(
        true,
      );
      // A category never substitutes for the free-text detail.
      expect(
        createAdjustmentSchema.safeParse({ ...valid, reasonCategory: category, reason: "" })
          .success,
      ).toBe(false);
    }
  });
});
