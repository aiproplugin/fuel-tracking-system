import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getUserHomeContext } from "@/server/services/user.service";

/**
 * Session-facing router. `me` returns the authenticated user's identity and
 * bound-tank context — the smoke test that login, JWT callbacks, and the
 * protected-procedure gate all work end to end.
 */
export const authRouter = createTRPCRouter({
  me: protectedProcedure.query(({ ctx }) => getUserHomeContext(ctx.session.user.id)),
});
