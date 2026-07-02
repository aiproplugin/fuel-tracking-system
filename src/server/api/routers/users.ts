import {
  assignTankSchema,
  createUserSchema,
  resetPasswordSchema,
  unlockUserSchema,
  updateUserSchema,
} from "@/lib/schemas/master-data";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import {
  assignTank,
  createUser,
  listUsers,
  resetPassword,
  unlockUser,
  updateUser,
} from "@/server/services/user-admin.service";

/** User management is ADMIN-only end to end (tank binding rule included). */
export const usersRouter = createTRPCRouter({
  list: adminProcedure.query(() => listUsers()),
  create: adminProcedure
    .input(createUserSchema)
    .mutation(({ ctx, input }) => createUser(ctx.session.user.id, input)),
  update: adminProcedure
    .input(updateUserSchema)
    .mutation(({ ctx, input }) => updateUser(ctx.session.user.id, input)),
  assignTank: adminProcedure
    .input(assignTankSchema)
    .mutation(({ ctx, input }) => assignTank(ctx.session.user.id, input)),
  resetPassword: adminProcedure
    .input(resetPasswordSchema)
    .mutation(({ ctx, input }) => resetPassword(ctx.session.user.id, input)),
  unlock: adminProcedure
    .input(unlockUserSchema)
    .mutation(({ ctx, input }) => unlockUser(ctx.session.user.id, input)),
});
