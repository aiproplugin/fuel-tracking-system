import { createAdjustmentSchema, stockListSchema } from "@/lib/schemas/stock";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { createAdjustment, listAdjustments } from "@/server/services/adjustment.service";

/**
 * Stock adjustments. Writing requires stock.adjust, which no fuel issuer may
 * hold — segregation of duties is enforced when the permission is assigned,
 * not here. Reading only requires ledger.view.
 */
export const adjustmentsRouter = createTRPCRouter({
  create: permissionProcedure("stock.adjust")
    .input(createAdjustmentSchema)
    .mutation(({ ctx, input }) => createAdjustment(ctx.actor, input)),
  list: permissionProcedure("ledger.view")
    .input(stockListSchema)
    .query(({ ctx, input }) => listAdjustments(ctx.actor, input)),
});
