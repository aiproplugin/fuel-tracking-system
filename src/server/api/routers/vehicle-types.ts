import { upsertVehicleTypeSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import { listVehicleTypes, upsertVehicleType } from "@/server/services/vehicle-type.service";

export const vehicleTypesRouter = createTRPCRouter({
  list: permissionProcedure("masterdata.view").query(() => listVehicleTypes()),
  upsert: permissionProcedure("masterdata.manage")
    .input(upsertVehicleTypeSchema)
    .mutation(({ ctx, input }) => upsertVehicleType(ctx.actor.id, input)),
});
