import { z } from "zod";
import { strictObject } from "@/lib/validation";
import { idSchema } from "@/lib/schemas/master-data";

/**
 * Quota input schemas. THE PAIR RULE: a quota is always an
 * (amount in litres + period) PAIR — quotaPairSchema is the only shape any
 * layer accepts, so amount and period can never be submitted (or desync)
 * independently. `null` where a pair is allowed means "clear this layer".
 */

export const quotaPeriodSchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);
export const quotaEnforcementModeSchema = z.enum(["OFF", "WARN_OVERRIDE", "HARD_BLOCK"]);
export const weekStartDaySchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

export const MAX_QUOTA_LITERS = 100_000;

export const quotaPairSchema = strictObject({
  liters: z.number().positive("Quota must be positive").max(MAX_QUOTA_LITERS),
  period: quotaPeriodSchema,
});

export type QuotaPairInput = z.infer<typeof quotaPairSchema>;

const reasonSchema = z.string().trim().min(5, "A reason is required (min 5 characters)").max(500);

// --- Settings (master switch + global default) --------------------------------

export const updateQuotaSettingsSchema = strictObject({
  enforcementEnabled: z.boolean(),
  enforcementMode: quotaEnforcementModeSchema,
  warningThresholdPct: z.number().int().min(1).max(100),
  weekStartDay: weekStartDaySchema,
  /** Group-wide catch-all pair; null = no global default. */
  globalQuota: quotaPairSchema.nullable(),
});

// --- Layer assignment (each layer stores the whole pair or nothing) -----------

export const setCompanyQuotaSchema = strictObject({
  companyId: idSchema,
  quota: quotaPairSchema.nullable(),
});

export const setVehicleTypeQuotaSchema = strictObject({
  vehicleTypeId: idSchema,
  quota: quotaPairSchema.nullable(),
});

export const setVehicleQuotaSchema = strictObject({
  vehicleId: idSchema,
  mode: z.enum(["INHERIT", "CUSTOM", "EXEMPT"]),
  quota: quotaPairSchema.nullable(),
}).superRefine((input, ctx) => {
  if (input.mode === "CUSTOM" && input.quota === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quota"],
      message: "A custom quota needs both litres and period",
    });
  }
  if (input.mode !== "CUSTOM" && input.quota !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quota"],
      message: "Only CUSTOM mode carries a quota pair",
    });
  }
});

export const bulkAssignQuotaSchema = strictObject({
  scope: z.enum(["COMPANY", "VEHICLE_TYPE", "SITE"]),
  scopeId: idSchema,
  /** Pair = set every matched vehicle to CUSTOM; null = reset them to INHERIT. */
  quota: quotaPairSchema.nullable(),
});

// --- Top-ups & override codes --------------------------------------------------

export const grantTopUpSchema = strictObject({
  vehicleId: idSchema,
  liters: z.number().positive().max(MAX_QUOTA_LITERS),
  reason: reasonSchema,
});

export const issueOverrideCodeSchema = strictObject({
  vehicleId: idSchema,
  reason: reasonSchema,
});

/** 6 digits, exactly — matches the code minted by the quota service. */
export const overrideCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

// --- Queries --------------------------------------------------------------------

export const quotaStatusSchema = strictObject({
  /** MANAGER/ADMIN may narrow to one site; SUPERVISOR is pinned server-side. */
  siteId: idSchema.optional(),
});

export const resolveVehicleQuotaSchema = strictObject({ vehicleId: idSchema });
