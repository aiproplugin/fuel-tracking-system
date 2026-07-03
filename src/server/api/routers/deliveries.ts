import { createDeliverySchema, stockListSchema } from "@/lib/schemas/stock";
import { createTRPCRouter, roleProcedure, supervisorProcedure } from "@/server/api/trpc";
import { createDelivery, listDeliveries } from "@/server/services/delivery.service";

/**
 * Deliveries. Create = SUPERVISOR (own site, re-checked in the service) or
 * ADMIN. No OPERATOR path by design (docs/security.md); MANAGER reads only.
 */
export const deliveriesRouter = createTRPCRouter({
  create: roleProcedure(["SUPERVISOR", "ADMIN"])
    .input(createDeliverySchema)
    .mutation(({ ctx, input }) => createDelivery(ctx.session.user, input)),
  list: supervisorProcedure
    .input(stockListSchema)
    .query(({ ctx, input }) => listDeliveries(ctx.session.user, input)),
});
