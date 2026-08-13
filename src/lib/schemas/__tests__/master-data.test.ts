import { describe, expect, it } from "vitest";
import { FUEL_TYPES } from "@/lib/fuel";
import {
  auditListSchema,
  createTankSchema,
  createUserSchema,
  createVehicleSchema,
  fuelTypeSchema,
  plateNumberSchema,
  upsertVehicleTypeSchema,
} from "@/lib/schemas/master-data";

const SITE_ID = "3f0a72c1-58cc-4e7a-9d21-0a2f6f5f9b11";
const TYPE_ID = "9b8d1e42-77aa-4f4e-8c53-2f1e9d3c4a55";
const COMPANY_ID = "5c1b83d2-66bb-4a3f-9d64-3a2f8e4b5c66";

describe("plateNumberSchema", () => {
  it("uppercases and accepts valid plates", () => {
    expect(plateNumberSchema.parse(" cab-4587 ")).toBe("CAB-4587");
  });

  it("rejects plates with invalid characters", () => {
    expect(plateNumberSchema.safeParse("CAB 4587").success).toBe(false);
    expect(plateNumberSchema.safeParse("CAB;4587").success).toBe(false);
  });
});

describe("createTankSchema", () => {
  const valid = {
    name: "Tank D",
    siteId: SITE_ID,
    fuelType: "DIESEL" as const,
    capacityLiters: 5000,
    lowStockThreshold: 1000,
  };

  it("accepts a valid tank", () => {
    expect(createTankSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a threshold at or above capacity", () => {
    expect(createTankSchema.safeParse({ ...valid, lowStockThreshold: 5000 }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(createTankSchema.safeParse({ ...valid, currentStock: 99999 }).success).toBe(false);
  });

  it("rejects non-positive capacity", () => {
    expect(createTankSchema.safeParse({ ...valid, capacityLiters: 0 }).success).toBe(false);
  });

  it("accepts every configured fuel type and nothing else", () => {
    for (const fuelType of FUEL_TYPES) {
      expect(createTankSchema.safeParse({ ...valid, fuelType }).success).toBe(true);
    }
    expect(createTankSchema.safeParse({ ...valid, fuelType: "LPG" }).success).toBe(false);
  });
});

describe("fuelTypeSchema", () => {
  it("stays in lockstep with FUEL_TYPES", () => {
    expect(fuelTypeSchema.options).toEqual([...FUEL_TYPES]);
  });

  it("accepts KEROSENE and rejects unknown or lowercased values", () => {
    expect(fuelTypeSchema.safeParse("KEROSENE").success).toBe(true);
    expect(fuelTypeSchema.safeParse("kerosene").success).toBe(false);
    expect(fuelTypeSchema.safeParse("LPG").success).toBe(false);
  });
});

describe("upsertVehicleTypeSchema", () => {
  it("rejects min >= max", () => {
    expect(
      upsertVehicleTypeSchema.safeParse({
        name: "Lorry",
        meterType: "DISTANCE",
        minEfficiency: 8,
        maxEfficiency: 8,
      }).success,
    ).toBe(false);
  });

  it("accepts a valid band for each meter type", () => {
    expect(
      upsertVehicleTypeSchema.safeParse({
        name: "Lorry",
        meterType: "DISTANCE",
        minEfficiency: 3,
        maxEfficiency: 8,
      }).success,
    ).toBe(true);
    expect(
      upsertVehicleTypeSchema.safeParse({
        name: "Forklift",
        meterType: "HOURS",
        minEfficiency: 0.8,
        maxEfficiency: 2.5,
      }).success,
    ).toBe(true);
    expect(
      upsertVehicleTypeSchema.safeParse({
        name: "Generator",
        meterType: "ENERGY",
        minEfficiency: 2.5,
        maxEfficiency: 4,
      }).success,
    ).toBe(true);
  });

  it("requires a known meter type", () => {
    expect(
      upsertVehicleTypeSchema.safeParse({
        name: "Lorry",
        meterType: "FURLONGS",
        minEfficiency: 3,
        maxEfficiency: 8,
      }).success,
    ).toBe(false);
    expect(
      upsertVehicleTypeSchema.safeParse({ name: "Lorry", minEfficiency: 3, maxEfficiency: 8 })
        .success,
    ).toBe(false);
  });
});

describe("createVehicleSchema", () => {
  it("rejects negative meter readings and unknown fields", () => {
    const valid = {
      plateNumber: "KX-1000",
      vehicleTypeId: TYPE_ID,
      companyId: COMPANY_ID,
      fuelType: "PETROL" as const,
      currentMeter: 1000,
    };
    expect(createVehicleSchema.safeParse(valid).success).toBe(true);
    expect(createVehicleSchema.safeParse({ ...valid, currentMeter: -1 }).success).toBe(false);
    expect(createVehicleSchema.safeParse({ ...valid, injected: true }).success).toBe(false);
  });

  it("accepts a KEROSENE vehicle", () => {
    expect(
      createVehicleSchema.safeParse({
        plateNumber: "KB-0450",
        vehicleTypeId: TYPE_ID,
        companyId: COMPANY_ID,
        fuelType: "KEROSENE" as const,
        currentMeter: 1180,
      }).success,
    ).toBe(true);
  });
});

describe("auditListSchema (regression: tRPC infinite-query transport keys)", () => {
  it("accepts the exact input shape tRPC v11 useInfiniteQuery sends", () => {
    // The client wrapper injects `cursor` and `direction`; rejecting them
    // broke the Audit page (rendered as \"No audit events yet\").
    const result = auditListSchema.safeParse({
      limit: 50,
      cursor: null,
      direction: "forward",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects genuinely unknown fields", () => {
    expect(auditListSchema.safeParse({ limit: 50, injected: true }).success).toBe(false);
  });

  it("defaults the limit and caps it at 100", () => {
    expect(auditListSchema.parse({}).limit).toBe(50);
    expect(auditListSchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});

describe("createUserSchema", () => {
  it("enforces the strong password policy on creation", () => {
    const base = {
      username: "newuser",
      displayName: "New User",
      role: "OPERATOR" as const,
      siteId: null,
    };
    expect(createUserSchema.safeParse({ ...base, password: "weak" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, password: "Str0ng!Passw0rd#2026" }).success).toBe(
      true,
    );
  });
});
