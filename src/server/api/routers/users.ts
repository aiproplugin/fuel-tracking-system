import {
  assignTankSchema,
  createUserSchema,
  resetPasswordSchema,
  unlockUserSchema,
  updateUserSchema,
} from "@/lib/schemas/master-data";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  assignTank,
  createUser,
  listUsers,
  resetPassword,
  unlockUser,
  updateUser,
} from "@/server/services/user-admin.service";

/**
 * User management. `user.manage` is a META-PERMISSION: it is reserved to the
 * ADMIN role and can never be handed out by a per-user override, so no
 * manager can grant themselves account control and escalate from there.
 */
export const usersRouter = createTRPCRouter({
  list: permissionProcedure("user.manage").query(() => listUsers()),
  create: permissionProcedure("user.manage")
    .input(createUserSchema)
    .mutation(({ ctx, input }) => createUser(ctx.actor.id, input)),
  update: permissionProcedure("user.manage")
    .input(updateUserSchema)
    .mutation(({ ctx, input }) => updateUser(ctx.actor.id, input)),
  assignTank: permissionProcedure("user.manage")
    .input(assignTankSchema)
    .mutation(({ ctx, input }) => assignTank(ctx.actor.id, input)),
  resetPassword: permissionProcedure("user.manage")
    .input(resetPasswordSchema)
    .mutation(({ ctx, input }) => resetPassword(ctx.actor.id, input)),
  unlock: permissionProcedure("user.manage")
    .input(unlockUserSchema)
    .mutation(({ ctx, input }) => unlockUser(ctx.actor.id, input)),
});
