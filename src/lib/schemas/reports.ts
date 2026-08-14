import { z } from "zod";
import { strictObject } from "@/lib/validation";
import { idSchema } from "@/lib/schemas/master-data";

/**
 * Report keys. The registry (server) is the single source of truth for what
 * each key does; this enum keeps client/API input constrained and typed.
 * `driver-usage` is only ever RUN when FEATURE_DRIVER_REPORTS is enabled —
 * enforced server-side, not by omission here.
 */
export const REPORT_KEYS = [
  "vehicle-usage",
  "vehicle-monthly",
  "vehicle-efficiency",
  "tank-ledger",
  "delivery-history",
  "adjustment-register",
  "abnormal-consumption",
  "low-stock",
  "driver-usage",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/** ISO date (yyyy-mm-dd) interpreted as an Asia/Colombo calendar day. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

/**
 * Shared report filter. All optional; each report applies only the filters it
 * supports. `siteId` is honoured for MANAGER/ADMIN only (supervisors are pinned
 * server-side). The date range is inclusive of both Colombo days.
 */
export const reportFilterSchema = strictObject({
  reportKey: z.enum(REPORT_KEYS),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  siteId: idSchema.optional(),
  vehicleId: idSchema.optional(),
  tankId: idSchema.optional(),
}).refine(
  (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: "dateFrom must be on or before dateTo", path: ["dateTo"] },
);

export type ReportFilter = z.infer<typeof reportFilterSchema>;

/** Export adds a format. CSV for every report; XLSX only where the report supports it. */
export const EXPORT_FORMATS = ["csv", "xlsx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const exportQuerySchema = z
  .object({
    reportKey: z.enum(REPORT_KEYS),
    format: z.enum(EXPORT_FORMATS).default("csv"),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    siteId: idSchema.optional(),
    vehicleId: idSchema.optional(),
    tankId: idSchema.optional(),
  })
  .strict();

export type ExportQuery = z.infer<typeof exportQuerySchema>;

/** Per-vehicle efficiency drill-down input. */
export const vehicleEfficiencyDetailSchema = strictObject({
  vehicleId: idSchema,
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
});

export type VehicleEfficiencyDetailInput = z.infer<typeof vehicleEfficiencyDetailSchema>;
