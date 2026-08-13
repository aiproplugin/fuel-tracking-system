import { createVehicleSchema, updateVehicleSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { createVehicle, listVehicles, updateVehicle } from "@/server/services/vehicle.service";

export const vehiclesRouter = createTRPCRouter({
  list: permissionProcedure("masterdata.view").query(({ ctx }) => listVehicles(ctx.actor)),
  create: permissionProcedure("masterdata.manage")
    .input(createVehicleSchema)
    .mutation(({ ctx, input }) => createVehicle(ctx.actor.id, input)),
  update: permissionProcedure("masterdata.manage")
    .input(updateVehicleSchema)
    .mutation(({ ctx, input }) => updateVehicle(ctx.actor.id, input)),
});
