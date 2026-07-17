import { describe, expect, it } from "vitest";
import {
  flagMeterExceptionSchema,
  lookupVehicleSchema,
  reviewMeterExceptionSchema,
  submitFuelIssueSchema,
} from "@/lib/schemas/fuel-issue";

const VEHICLE_ID = "3f0a72c1-58cc-4e7a-9d21-0a2f6f5f9b11";
const KEY = "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55";

describe("submitFuelIssueSchema", () => {
  const valid = { vehicleId: VEHICLE_ID, idempotencyKey: KEY, liters: 42, meterReading: 125_120 };

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

  it("rejects fractional meter readings (whole km/hrs/kWh only)", () => {
    expect(submitFuelIssueSchema.safeParse({ ...valid, meterReading: 1000.5 }).success).toBe(false);
  });
});

describe("lookupVehicleSchema", () => {
  it("defaults manual to false and trims the token", () => {
    const parsed = lookupVehicleSchema.parse({ token: "  FT-abc123  " });
    expect(parsed.token).toBe("FT-abc123");
    expect(parsed.manual).toBe(false);
  });
});

describe("flagMeterExceptionSchema", () => {
  it("requires positive liters", () => {
    expect(
      flagMeterExceptionSchema.safeParse({
        vehicleId: VEHICLE_ID,
        attemptedReading: 124_100,
        liters: 0,
      }).success,
    ).toBe(false);
  });
});

describe("reviewMeterExceptionSchema", () => {
  const base = { exceptionId: VEHICLE_ID, reason: "Meter photo verified by supervisor." };

  it("requires a corrected reading to APPROVE", () => {
    expect(reviewMeterExceptionSchema.safeParse({ ...base, decision: "APPROVE" }).success).toBe(
      false,
    );
    expect(
      reviewMeterExceptionSchema.safeParse({
        ...base,
        decision: "APPROVE",
        correctedReading: 125_140,
      }).success,
    ).toBe(true);
  });

  it("allows REJECT without a corrected reading but demands a reason", () => {
    expect(reviewMeterExceptionSchema.safeParse({ ...base, decision: "REJECT" }).success).toBe(
      true,
    );
    expect(
      reviewMeterExceptionSchema.safeParse({
        exceptionId: VEHICLE_ID,
        decision: "REJECT",
        reason: "no",
      }).success,
    ).toBe(false);
  });
});
