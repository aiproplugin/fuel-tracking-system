import { z } from "zod";
import { strictObject } from "@/lib/validation";
import { idSchema } from "@/lib/schemas/master-data";

/**
 * Dashboard filter input (strict). Both fields are optional so the client may
 * call with `{}`; defaults are applied server-side.
 *
 * - `range` scopes the volume KPIs (fuel issued, abnormal count) to today or
 *   the trailing 7 Colombo days. Point-in-time KPIs (stock, low-stock, pending
 *   exceptions) ignore it.
 * - `siteId` is honoured for MANAGER/ADMIN only. A SUPERVISOR is always pinned
 *   to their own site server-side and any supplied `siteId` is ignored (never
 *   trusted) — see dashboard.service.
 */
export const DASHBOARD_RANGES = ["TODAY", "SEVEN_DAYS"] as const;

export const dashboardFilterSchema = strictObject({
  range: z.enum(DASHBOARD_RANGES).default("SEVEN_DAYS"),
  siteId: idSchema.optional(),
});

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
