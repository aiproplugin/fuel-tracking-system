import { tokenIdSchema, vehicleIdSchema } from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import {
  createTokenForVehicle,
  deactivateToken,
  getPrintData,
  listVehicleTokens,
  rotateToken,
} from "@/server/services/qr-token.service";

/** QR token lifecycle is ADMIN-only; scanning (Phase 3) uses a separate lookup. */
export const qrTokensRouter = createTRPCRouter({
  list: adminProcedure.query(() => listVehicleTokens()),
  create: adminProcedure
    .input(vehicleIdSchema)
    .mutation(({ ctx, input }) => createTokenForVehicle(ctx.session.user.id, input)),
  rotate: adminProcedure
    .input(vehicleIdSchema)
    .mutation(({ ctx, input }) => rotateToken(ctx.session.user.id, input)),
  deactivate: adminProcedure
    .input(tokenIdSchema)
    .mutation(({ ctx, input }) => deactivateToken(ctx.session.user.id, input)),
  printData: adminProcedure.input(vehicleIdSchema).query(({ input }) => getPrintData(input)),
});
