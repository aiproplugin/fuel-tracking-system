import { env } from "@/lib/env";
import { reportFilterSchema, vehicleEfficiencyDetailSchema } from "@/lib/schemas/reports";
import { createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { availableReports } from "@/server/services/reports/report-registry";
import { getVehicleEfficiencyDetail, runReport } from "@/server/services/reports/report.service";

/** On-screen row cap. Summary/totalRows stay full-set correct; exports get more. */
export const ON_SCREEN_ROW_LIMIT = 500;

/**
 * Reports (supervisor+). Scoping and the driver-report feature gate live in the
 * service; this router only surfaces the catalogue, the on-screen run, and the
 * efficiency drill-down. Exports are served by the /api/reports/export route
 * handler (binary download), which calls the SAME service.
 */
export const reportsRouter = createTRPCRouter({
  available: supervisorProcedure.query(() => availableReports(env.FEATURE_DRIVER_REPORTS)),

  run: supervisorProcedure.input(reportFilterSchema).query(({ ctx, input }) => {
    const { reportKey, ...filters } = input;
    return runReport(ctx.session.user, reportKey, filters, { rowLimit: ON_SCREEN_ROW_LIMIT });
  }),

  vehicleDetail: supervisorProcedure
    .input(vehicleEfficiencyDetailSchema)
    .query(({ ctx, input }) =>
      getVehicleEfficiencyDetail(ctx.session.user, input.vehicleId, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
      }),
    ),
});
