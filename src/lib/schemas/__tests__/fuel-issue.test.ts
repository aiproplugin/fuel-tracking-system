import { describe, expect, it } from "vitest";
import {
  flagOdometerExceptionSchema,
  lookupVehicleSchema,
  reviewOdometerExceptionSchema,
  submitFuelIssueSchema,
} from "@/lib/schemas/fuel-issue";

const VEHICLE_ID = "3f0a72c1-58cc-4e7a-9d21-0a2f6f5f9b11";
const KEY = "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55";

describe("submitFuelIssueSchema", () => {
  const valid = { vehicleId: VEHICLE_ID, idempotencyKey: KEY, liters: 42, odometer: 125_120 };

  it("accepts a valid submission", () => {
    expect(submitFuelIssueSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects zero/negative liters", () => {
    expect(submitFuelIssueSchema.safeParse({ ...valid, liters: 0 }).success).toBe(false);
    expect(submitFuelIssueSchema.safeParse({ ...valid, liters: -5 }).success).toBe(false);
  });

  it("rejects non-uuid idempotency keys", () => {
    expect(submitFuelIssueSchema.safeParse({ ...valid, idempotencyKey: "retry-1" }).success).toBe(
      false,
    );
  });

  it("rejects unknown fields — including any attempt to send a tank", () => {
    expect(submitFuelIssueSchema.safeParse({ ...valid, tankId: VEHICLE_ID }).success).toBe(false);
  });

  it("rejects fractional odometers", () => {
    expect(submitFuelIssueSchema.safeParse({ ...valid, odometer: 1000.5 }).success).toBe(false);
  });
});

describe("lookupVehicleSchema", () => {
  it("defaults manual to false and trims the token", () => {
    const parsed = lookupVehicleSchema.parse({ token: "  FT-abc123  " });
    expect(parsed.token).toBe("FT-abc123");
    expect(parsed.manual).toBe(false);
  });
});

describe("flagOdometerExceptionSchema", () => {
  it("requires positive liters", () => {
    expect(
      flagOdometerExceptionSchema.safeParse({
        vehicleId: VEHICLE_ID,
        attemptedOdometer: 124_100,
        liters: 0,
      }).success,
    ).toBe(false);
  });
});

describe("reviewOdometerExceptionSchema", () => {
  const base = { exceptionId: VEHICLE_ID, reason: "Meter photo verified by supervisor." };

  it("requires a corrected odometer to APPROVE", () => {
    expect(reviewOdometerExceptionSchema.safeParse({ ...base, decision: "APPROVE" }).success).toBe(
      false,
    );
    expect(
      reviewOdometerExceptionSchema.safeParse({
        ...base,
        decision: "APPROVE",
        correctedOdometer: 125_140,
      }).success,
    ).toBe(true);
  });

  it("allows REJECT without a corrected odometer but demands a reason", () => {
    expect(reviewOdometerExceptionSchema.safeParse({ ...base, decision: "REJECT" }).success).toBe(
      true,
    );
    expect(
      reviewOdometerExceptionSchema.safeParse({
        exceptionId: VEHICLE_ID,
        decision: "REJECT",
        reason: "no",
      }).success,
    ).toBe(false);
  });
});
