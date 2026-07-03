import { createAdjustmentSchema, stockListSchema } from "@/lib/schemas/stock";
import { createTRPCRouter, roleProcedure, supervisorProcedure } from "@/server/api/trpc";
import { createAdjustment, listAdjustments } from "@/server/services/adjustment.service";

/**
 * Stock adjustments. Authority per CLAUDE.md: SUPERVISOR or ADMIN —
 * MANAGER is deliberately NOT in the allowlist. MANAGER may read.
 */
export const adjustmentsRouter = createTRPCRouter({
  create: roleProcedure(["SUPERVISOR", "ADMIN"])
    .input(createAdjustmentSchema)
    .mutation(({ ctx, input }) => createAdjustment(ctx.session.user, input)),
  list: supervisorProcedure
    .input(stockListSchema)
    .query(({ ctx, input }) => listAdjustments(ctx.session.user, input)),
});
