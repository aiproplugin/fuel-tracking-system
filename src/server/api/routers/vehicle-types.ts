import { upsertVehicleTypeSchema } from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import { listVehicleTypes, upsertVehicleType } from "@/server/services/vehicle-type.service";

export const vehicleTypesRouter = createTRPCRouter({
  list: supervisorProcedure.query(() => listVehicleTypes()),
  upsert: adminProcedure
    .input(upsertVehicleTypeSchema)
    .mutation(({ ctx, input }) => upsertVehicleType(ctx.session.user.id, input)),
});
