import { z } from "zod";
import { idSchema } from "@/lib/schemas/master-data";
import { strictObject } from "@/lib/validation";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { repairTankCache, runReconciliation } from "@/server/services/reconciliation.service";

/**
 * Ledger reconciliation. Read = SUPERVISOR+ (site-scoped). Cache repair =
 * ADMIN only, and only when the movement chain itself is intact.
 */
export const reconciliationRouter = createTRPCRouter({
  run: supervisorProcedure.query(({ ctx }) => runReconciliation(ctx.session.user)),
  repair: adminProcedure
    .input(strictObject({ tankId: idSchema, confirm: z.literal(true) }))
    .mutation(({ ctx, input }) => repairTankCache(ctx.session.user.id, input.tankId)),
});
