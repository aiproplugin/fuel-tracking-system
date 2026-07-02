import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { createRequestLogger } from "@/lib/logger";
import { auth } from "@/server/auth";

/**
 * tRPC context — one per request. Carries the session and a correlation-ID
 * child logger so every log line of a request is traceable.
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();
  const correlationId = crypto.randomUUID();
  return {
    session,
    headers: opts.headers,
    logger: createRequestLogger(correlationId),
    correlationId,
  };
};

type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Field-level Zod issues are safe to expose; anything else stays generic.
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/** Procedure with no auth requirement (health checks, login-adjacent lookups). */
export const publicProcedure = t.procedure;

/**
 * Procedure requiring an authenticated session. Phase 1 layers role checks
 * (OPERATOR / SUPERVISOR / MANAGER / ADMIN) and data-scoping middleware on
 * top of this — every protected procedure re-verifies authority server-side.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});
