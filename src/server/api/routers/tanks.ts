import { createTankSchema, updateTankSchema } from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { createTank, getStockSummary, listTanks, updateTank } from "@/server/services/tank.service";

export const tanksRouter = createTRPCRouter({
  /** Supervisor sees own site only; manager/admin see all (service-side scoping). */
  list: supervisorProcedure.query(({ ctx }) => listTanks(ctx.session.user)),
  stockSummary: supervisorProcedure.query(({ ctx }) => getStockSummary(ctx.session.user)),
  create: adminProcedure
    .input(createTankSchema)
    .mutation(({ ctx, input }) => createTank(ctx.session.user.id, input)),
  update: adminProcedure
    .input(updateTankSchema)
    .mutation(({ ctx, input }) => updateTank(ctx.session.user.id, input)),
});
