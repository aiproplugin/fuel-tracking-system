import { changePasswordSchema } from "@/lib/validation";
import { createTRPCRouter, protectedProcedure, sessionProcedure } from "@/server/api/trpc";
import { changeOwnPassword, getUserHomeContext } from "@/server/services/user.service";

/**
 * Session-facing router. `me` returns the authenticated user's identity and
 * bound-tank context. `changePassword` deliberately uses sessionProcedure:
 * it must remain reachable while the temporary-password gate blocks every
 * other protected procedure.
 */
export const authRouter = createTRPCRouter({
  me: protectedProcedure.query(({ ctx }) => getUserHomeContext(ctx.session.user.id)),
  changePassword: sessionProcedure.input(changePasswordSchema).mutation(({ ctx, input }) =>
    changeOwnPassword({
      userId: ctx.session.user.id,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    }),
  ),
});
