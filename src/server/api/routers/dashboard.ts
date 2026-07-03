import { dashboardFilterSchema } from "@/lib/schemas/dashboard";
import { createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { getDashboardSummary } from "@/server/services/dashboard.service";

/**
 * D1 dashboard read model. Supervisor+ only (operators have no dashboard).
 * Site/role scoping is enforced inside the service — the `siteId` filter is
 * ignored for supervisors, never trusted from the client.
 */
export const dashboardRouter = createTRPCRouter({
  summary: supervisorProcedure
    .input(dashboardFilterSchema)
    .query(({ ctx, input }) => getDashboardSummary(ctx.session.user, input)),
});
