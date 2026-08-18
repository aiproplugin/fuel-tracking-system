import { z } from "zod";
import { FUEL_TYPES } from "@/lib/fuel";
import { passwordSchema, strictObject, usernameSchema } from "@/lib/validation";

/**
 * Server-side input schemas for master-data CRUD. All built on strictObject
 * so unknown fields are rejected (CLAUDE.md input-validation rule).
 */

export const idSchema = z.string().uuid();

/** Derived from FUEL_TYPES so a new fuel type is accepted server-side automatically. */
export const fuelTypeSchema = z.enum(FUEL_TYPES);
export const roleSchema = z.enum(["OPERATOR", "SUPERVISOR", "MANAGER", "ADMIN"]);

export const nameSchema = z.string().trim().min(2).max(80);

/** Sri Lankan style plates plus generic fleet codes: "CAB-4587", "NC-7712". */
export const plateNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Plate number is too short")
  .max(16, "Plate number is too long")
  .regex(/^[A-Z0-9-]+$/, "Plate may only contain letters, digits, and hyphens");

// --- Sites ------------------------------------------------------------------

export const createSiteSchema = strictObject({ name: nameSchema, companyId: idSchema });

export const updateSiteSchema = strictObject({
  id: idSchema,
  name: nameSchema,
  companyId: idSchema,
});

export const deleteSiteSchema = strictObject({ id: idSchema });

// --- Tanks ------------------------------------------------------------------

const litersPositive = z.number().positive().max(1_000_000);

export const createTankSchema = strictObject({
  name: nameSchema,
  siteId: idSchema,
  fuelType: fuelTypeSchema,
  capacityLiters: litersPositive,
  lowStockThreshold: litersPositive,
}).refine((tank) => tank.lowStockThreshold < tank.capacityLiters, {
  message: "Low-stock threshold must be below capacity",
  path: ["lowStockThreshold"],
});

export const updateTankSchema = strictObject({
  id: idSchema,
  name: nameSchema,
  capacityLiters: litersPositive,
  lowStockThreshold: litersPositive,
  isActive: z.boolean(),
}).refine((tank) => tank.lowStockThreshold < tank.capacityLiters, {
  message: "Low-stock threshold must be below capacity",
  path: ["lowStockThreshold"],
});

// --- Vehicle types (Settings: meter type + abnormal-consumption bands) -------

export const meterTypeSchema = z.enum(["DISTANCE", "HOURS", "ENERGY"]);

/** Band bound in the type's own efficiency unit (km/L, hrs/L, kWh/L). */
const efficiencyBoundSchema = z.number().positive().max(200);

export const upsertVehicleTypeSchema = strictObject({
  id: idSchema.optional(),
  name: nameSchema,
  meterType: meterTypeSchema,
  minEfficiency: efficiencyBoundSchema,
  maxEfficiency: efficiencyBoundSchema,
}).refine((band) => band.minEfficiency < band.maxEfficiency, {
  message: "Minimum efficiency must be below maximum efficiency",
  path: ["minEfficiency"],
});

export const deleteVehicleTypeSchema = strictObject({ id: idSchema });

// --- Vehicles -----------------------------------------------------------------

export const createVehicleSchema = strictObject({
  plateNumber: plateNumberSchema,
  vehicleTypeId: idSchema,
  companyId: idSchema,
  fuelType: fuelTypeSchema,
  /** Starting reading in the type's meter unit (km / hrs / kWh). */
  currentMeter: z.number().int().min(0).max(10_000_000),
});

export const updateVehicleSchema = strictObject({
  id: idSchema,
  plateNumber: plateNumberSchema,
  vehicleTypeId: idSchema,
  companyId: idSchema,
  fuelType: fuelTypeSchema,
  isActive: z.boolean(),
});

// --- Users --------------------------------------------------------------------

export const createUserSchema = strictObject({
  username: usernameSchema,
  password: passwordSchema,
  displayName: nameSchema,
  role: roleSchema,
  siteId: idSchema.nullable(),
});

export const updateUserSchema = strictObject({
  id: idSchema,
  displayName: nameSchema,
  role: roleSchema,
  siteId: idSchema.nullable(),
  isActive: z.boolean(),
});

export const assignTankSchema = strictObject({
  userId: idSchema,
  tankId: idSchema.nullable(),
});

export const resetPasswordSchema = strictObject({
  userId: idSchema,
  newPassword: passwordSchema,
});

export const unlockUserSchema = strictObject({ userId: idSchema });

// --- QR tokens ------------------------------------------------------------------

export const vehicleIdSchema = strictObject({ vehicleId: idSchema });
export const tokenIdSchema = strictObject({ tokenId: idSchema });

// --- Audit ----------------------------------------------------------------------

export const auditListSchema = strictObject({
  cursor: z.bigint().nullish(),
  limit: z.number().int().min(1).max(100).default(50),
  // tRPC v11's useInfiniteQuery injects `direction` (and `cursor`) into the
  // input it sends; without this key the strict schema rejects every request
  // the Audit page makes. The service ignores it — newest-first only.
  direction: z.enum(["forward", "backward"]).optional(),
});
