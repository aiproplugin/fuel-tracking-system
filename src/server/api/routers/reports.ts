import { env } from "@/lib/env";
import { reportFilterSchema, vehicleEfficiencyDetailSchema } from "@/lib/schemas/reports";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { availableReports } from "@/server/services/reports/report-registry";
import { getVehicleEfficiencyDetail, runReport } from "@/server/services/reports/report.service";

/** On-screen row cap. Summary/totalRows stay full-set correct; exports get more. */
export const ON_SCREEN_ROW_LIMIT = 500;

/**
 * Reports. `report.run` unlocks the capability; how MUCH data comes back is a
 * separate question answered by the actor's report-scope permission
 * (report.view.all vs report.view.site) inside the service. Exports are served
 * by the /api/reports/export route handler (binary download), which calls the
 * SAME service through the same permission checks.
 */
export const reportsRouter = createTRPCRouter({
  // Listing is filtered by the actor's effective permissions, so a report over
  // privileged data (the audit trail) is never advertised to someone who
  // cannot run it. runReport re-checks on every call — this is UX only.
  available: permissionProcedure("report.run").query(({ ctx }) =>
    availableReports(env.FEATURE_DRIVER_REPORTS, ctx.actor.permissions),
  ),

  run: permissionProcedure("report.run")
    .input(reportFilterSchema)
    .query(({ ctx, input }) => {
      const { reportKey, ...filters } = input;
      return runReport(ctx.actor, reportKey, filters, { rowLimit: ON_SCREEN_ROW_LIMIT });
    }),

  vehicleDetail: permissionProcedure("report.run")
    .input(vehicleEfficiencyDetailSchema)
    .query(({ ctx, input }) =>
      getVehicleEfficiencyDetail(ctx.actor, input.vehicleId, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      }),
    ),
});
