import {
  flagOdometerExceptionSchema,
  fuelIssueListSchema,
  lookupVehicleSchema,
  reviewOdometerExceptionSchema,
  submitFuelIssueSchema,
} from "@/lib/schemas/fuel-issue";
import {
  adminProcedure,
  createTRPCRouter,
  operatorProcedure,
  supervisorProcedure,
} from "@/server/api/trpc";
import {
  flagOdometerException,
  getOperatorDay,
  listFuelIssues,
  listOdometerExceptions,
  lookupVehicleForIssue,
  reviewOdometerException,
  submitFuelIssue,
} from "@/server/services/fuel-issue.service";

/**
 * Fuel entry core. Operator procedures take the tank from the SESSION —
 * there is no tank input anywhere in this router. Review authority is
 * ADMIN-only per the odometer rule.
 */
export const fuelIssuesRouter = createTRPCRouter({
  // Mutations (not queries) so react-query never caches or auto-retries them.
  lookupVehicle: operatorProcedure
    .input(lookupVehicleSchema)
    .mutation(({ ctx, input }) => lookupVehicleForIssue(ctx.session.user, input)),

  submit: operatorProcedure
    .input(submitFuelIssueSchema)
    .mutation(({ ctx, input }) => submitFuelIssue(ctx.session.user, input)),

  flagException: operatorProcedure
    .input(flagOdometerExceptionSchema)
    .mutation(({ ctx, input }) => flagOdometerException(ctx.session.user, input)),

  myDay: operatorProcedure.query(({ ctx }) => getOperatorDay(ctx.session.user)),

  list: supervisorProcedure
    .input(fuelIssueListSchema)
    .query(({ ctx, input }) => listFuelIssues(ctx.session.user, input)),

  exceptions: supervisorProcedure.query(({ ctx }) => listOdometerExceptions(ctx.session.user)),

  reviewException: adminProcedure
    .input(reviewOdometerExceptionSchema)
    .mutation(({ ctx, input }) => reviewOdometerException(ctx.session.user.id, input)),
});
