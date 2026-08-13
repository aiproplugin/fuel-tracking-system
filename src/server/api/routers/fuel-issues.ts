import {
  flagMeterExceptionSchema,
  fuelIssueListSchema,
  lookupVehicleSchema,
  reviewMeterExceptionSchema,
  submitFuelIssueSchema,
} from "@/lib/schemas/fuel-issue";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  flagMeterException,
  getOperatorDay,
  listFuelIssues,
  listMeterExceptions,
  lookupVehicleForIssue,
  reviewMeterException,
  submitFuelIssue,
} from "@/server/services/fuel-issue.service";

/**
 * Fuel entry core. The issuing procedures take the tank from the SESSION —
 * there is no tank input anywhere in this router — and fuel.issue is only ever
 * assignable to a user with a bound tank (guardrail), so the actor always has
 * one here. Review authority is a separate, stronger permission per the meter
 * rule: it is the ONLY override path for a blocked reading.
 */
export const fuelIssuesRouter = createTRPCRouter({
  // Mutations (not queries) so react-query never caches or auto-retries them.
  lookupVehicle: permissionProcedure("vehicle.lookup")
    .input(lookupVehicleSchema)
    .mutation(({ ctx, input }) => lookupVehicleForIssue(ctx.actor, input)),

  submit: permissionProcedure("fuel.issue")
    .input(submitFuelIssueSchema)
    .mutation(({ ctx, input }) => submitFuelIssue(ctx.actor, input)),

  flagException: permissionProcedure("fuel.issue")
    .input(flagMeterExceptionSchema)
    .mutation(({ ctx, input }) => flagMeterException(ctx.actor, input)),

  myDay: permissionProcedure("report.view.own").query(({ ctx }) => getOperatorDay(ctx.actor)),

  list: permissionProcedure("fuelissue.view")
    .input(fuelIssueListSchema)
    .query(({ ctx, input }) => listFuelIssues(ctx.actor, input)),

  exceptions: permissionProcedure("fuelissue.view").query(({ ctx }) =>
    listMeterExceptions(ctx.actor),
  ),

  reviewException: permissionProcedure("exception.review")
    .input(reviewMeterExceptionSchema)
    .mutation(({ ctx, input }) => reviewMeterException(ctx.actor.id, input)),
});
