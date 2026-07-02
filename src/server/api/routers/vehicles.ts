import { createVehicleSchema, updateVehicleSchema } from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { createVehicle, listVehicles, updateVehicle } from "@/server/services/vehicle.service";

export const vehiclesRouter = createTRPCRouter({
  list: supervisorProcedure.query(({ ctx }) => listVehicles(ctx.session.user)),
  create: adminProcedure
    .input(createVehicleSchema)
    .mutation(({ ctx, input }) => createVehicle(ctx.session.user.id, input)),
  update: adminProcedure
    .input(updateVehicleSchema)
    .mutation(({ ctx, input }) => updateVehicle(ctx.session.user.id, input)),
});
