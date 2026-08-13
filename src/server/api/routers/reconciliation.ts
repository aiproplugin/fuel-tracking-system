import { z } from "zod";
import { idSchema } from "@/lib/schemas/master-data";
import { strictObject } from "@/lib/validation";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { repairTankCache, runReconciliation } from "@/server/services/reconciliation.service";

/**
 * Ledger reconciliation. Reading is site-scoped in the service; cache repair
 * is a separate, stronger permission and only runs when the movement chain
 * itself is intact.
 */
export const reconciliationRouter = createTRPCRouter({
  run: permissionProcedure("reconcile.run").query(({ ctx }) => runReconciliation(ctx.actor)),
  repair: permissionProcedure("reconcile.repair")
    .input(strictObject({ tankId: idSchema, confirm: z.literal(true) }))
    .mutation(({ ctx, input }) => repairTankCache(ctx.actor.id, input.tankId)),
});
