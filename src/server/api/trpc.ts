import { initTRPC, TRPCError } from "@trpc/server";
import type { Role } from "@prisma/client";
import superjson from "superjson";
import { ZodError } from "zod";
import { createRequestLogger } from "@/lib/logger";
import { auth } from "@/server/auth";
import { db } from "@/server/db";

/**
 * tRPC context — one per request. Carries the session, the Prisma client
 * (for services), and a correlation-ID child logger so every log line of a
 * request is traceable.
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth();
  const correlationId = crypto.randomUUID();
  return {
    session,
    db,
    headers: opts.headers,
    logger: createRequestLogger(correlationId),
    correlationId,
  };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

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

/** Procedure requiring an authenticated session. */
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

/**
 * Role-gated procedure with an EXPLICIT allowlist (least privilege — no
 * implicit hierarchy, because e.g. adjustments allow SUPERVISOR and ADMIN
 * but not MANAGER). Ownership/data-scoping checks (operator=own tank,
 * supervisor=own site) are enforced per-procedure in the services on top
 * of this gate.
 *
 * Usage: roleProcedure(["ADMIN"]).mutation(...)
 */
export function roleProcedure(allowedRoles: readonly Role[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (!allowedRoles.includes(ctx.session.user.role)) {
      ctx.logger.warn(
        { userId: ctx.session.user.id, role: ctx.session.user.role, allowedRoles },
        "Forbidden: role not allowed for procedure",
      );
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next();
  });
}

/** Convenience gates for the common cases. */
export const adminProcedure = roleProcedure(["ADMIN"]);
export const managerProcedure = roleProcedure(["MANAGER", "ADMIN"]);
export const supervisorProcedure = roleProcedure(["SUPERVISOR", "MANAGER", "ADMIN"]);
