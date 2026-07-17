import { z } from "zod";
import { strictObject } from "@/lib/validation";
import { idSchema } from "@/lib/schemas/master-data";

/**
 * Fuel-entry input schemas. All strict; the tank is NEVER an input — it
 * comes from the operator's session binding, server-side only.
 */

/** Opaque QR token as scanned or typed (FT-<uuid> today; format may evolve). */
export const lookupVehicleSchema = strictObject({
  token: z.string().trim().min(4).max(64),
  /** Manual keyboard entry is rate-limited harder than camera scans. */
  manual: z.boolean().default(false),
});

export const MAX_LITERS_PER_ISSUE = 10_000;
/** Whole units of the vehicle type's meter (km / hrs / kWh). */
export const MAX_METER_READING = 10_000_000;

export const submitFuelIssueSchema = strictObject({
  vehicleId: idSchema,
  /** Client-generated per attempt; retries/double-taps reuse the same key. */
  idempotencyKey: idSchema,
  liters: z.number().positive("Liters must be positive").max(MAX_LITERS_PER_ISSUE),
  meterReading: z.number().int().min(0).max(MAX_METER_READING),
  /**
   * Single-use supervisor override code for an over-quota fill
   * (WARN_OVERRIDE enforcement mode only). Validated and consumed server-side.
   */
  overrideCode: z
    .string()
    .regex(/^\d{6}$/, "Enter the 6-digit code")
    .optional(),
});

export const flagMeterExceptionSchema = strictObject({
  vehicleId: idSchema,
  attemptedReading: z.number().int().min(0).max(MAX_METER_READING),
  liters: z.number().positive().max(MAX_LITERS_PER_ISSUE),
});

export const reviewMeterExceptionSchema = strictObject({
  exceptionId: idSchema,
  decision: z.enum(["APPROVE", "REJECT"]),
  correctedReading: z.number().int().min(0).max(MAX_METER_READING).optional(),
  reason: z.string().trim().min(5, "A reason is required (min 5 characters)").max(500),
}).superRefine((review, ctx) => {
  if (review.decision === "APPROVE" && review.correctedReading === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correctedReading"],
      message: "A corrected meter reading is required to approve",
    });
  }
});

export const fuelIssueListSchema = strictObject({
  cursor: idSchema.nullish(),
  limit: z.number().int().min(1).max(100).default(20),
  // Injected by tRPC's useInfiniteQuery transport; ignored by the service.
  direction: z.enum(["forward", "backward"]).optional(),
});
