import { createTankSchema, updateTankSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { createTank, getStockSummary, listTanks, updateTank } from "@/server/services/tank.service";

export const tanksRouter = createTRPCRouter({
  /** Data scope follows the actor's report-scope permission (service-side). */
  list: permissionProcedure("masterdata.view").query(({ ctx }) => listTanks(ctx.actor)),
  stockSummary: permissionProcedure("masterdata.view").query(({ ctx }) =>
    getStockSummary(ctx.actor),
  ),
  create: permissionProcedure("masterdata.manage")
    .input(createTankSchema)
    .mutation(({ ctx, input }) => createTank(ctx.actor.id, input)),
  update: permissionProcedure("masterdata.manage")
    .input(updateTankSchema)
    .mutation(({ ctx, input }) => updateTank(ctx.actor.id, input)),
});
