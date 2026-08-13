import { createDeliverySchema, stockListSchema } from "@/lib/schemas/stock";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { createDelivery, listDeliveries } from "@/server/services/delivery.service";

/**
 * Deliveries. Writing requires delivery.record, which no fuel issuer may hold
 * (segregation of duties). Site ownership is re-checked in the service.
 */
export const deliveriesRouter = createTRPCRouter({
  create: permissionProcedure("delivery.record")
    .input(createDeliverySchema)
    .mutation(({ ctx, input }) => createDelivery(ctx.actor, input)),
  list: permissionProcedure("ledger.view")
    .input(stockListSchema)
    .query(({ ctx, input }) => listDeliveries(ctx.actor, input)),
});
