import { describe, expect, it } from "vitest";
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
});
