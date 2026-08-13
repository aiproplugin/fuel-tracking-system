import { tokenIdSchema, vehicleIdSchema } from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  createTokenForVehicle,
  deactivateToken,
  getPrintData,
  listVehicleTokens,
  rotateToken,
} from "@/server/services/qr-token.service";

/** QR token lifecycle; scanning (Phase 3) uses a separate lookup permission. */
export const qrTokensRouter = createTRPCRouter({
  list: permissionProcedure("qrtoken.manage").query(() => listVehicleTokens()),
  create: permissionProcedure("qrtoken.manage")
    .input(vehicleIdSchema)
    .mutation(({ ctx, input }) => createTokenForVehicle(ctx.actor.id, input)),
  rotate: permissionProcedure("qrtoken.manage")
    .input(vehicleIdSchema)
    .mutation(({ ctx, input }) => rotateToken(ctx.actor.id, input)),
  deactivate: permissionProcedure("qrtoken.manage")
    .input(tokenIdSchema)
    .mutation(({ ctx, input }) => deactivateToken(ctx.actor.id, input)),
  printData: permissionProcedure("qrtoken.manage")
    .input(vehicleIdSchema)
    .query(({ input }) => getPrintData(input)),
});
