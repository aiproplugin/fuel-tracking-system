import { deleteVehicleTypeSchema, upsertVehicleTypeSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  deleteVehicleType,
  listVehicleTypes,
  upsertVehicleType,
} from "@/server/services/vehicle-type.service";

export const vehicleTypesRouter = createTRPCRouter({
  list: permissionProcedure("masterdata.view").query(() => listVehicleTypes()),
  upsert: permissionProcedure("masterdata.manage")
    .input(upsertVehicleTypeSchema)
    .mutation(({ ctx, input }) => upsertVehicleType(ctx.actor.id, input)),
  delete: permissionProcedure("masterdata.manage")
    .input(deleteVehicleTypeSchema)
    .mutation(({ ctx, input }) => deleteVehicleType(ctx.actor.id, input)),
});
