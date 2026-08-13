import { dashboardFilterSchema } from "@/lib/schemas/dashboard";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { getDashboardSummary } from "@/server/services/dashboard.service";

/**
 * D1 dashboard read model. Site scoping is enforced inside the service from
 * the actor's report-scope permission — the `siteId` filter is ignored for an
 * actor limited to their own site, never trusted from the client.
 */
export const dashboardRouter = createTRPCRouter({
  summary: permissionProcedure("dashboard.view")
    .input(dashboardFilterSchema)
    .query(({ ctx, input }) => getDashboardSummary(ctx.actor, input)),
});
