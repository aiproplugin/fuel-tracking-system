import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { createRequestLogger } from "@/lib/logger";
import type { Permission } from "@/lib/permissions";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { buildActor } from "@/server/services/permission.service";

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

/**
 * Procedure requiring an authenticated session but NOT a completed password
 * change. Only for the change-password flow itself — everything else uses
 * protectedProcedure.
 */
export const sessionProcedure = t.procedure.use(({ ctx, next }) => {
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
 * Procedure requiring an authenticated session. Sessions carrying an
 * admin-set temporary password are blocked server-side (the /change-password
 * redirect is only UX) until the user sets their own password.
 */
export const protectedProcedure = sessionProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.mustChangePassword) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Password change required before continuing.",
    });
  }
  return next();
});

/**
 * PERMISSION-GATED PROCEDURE — the only authorization gate in the system.
 *
 * Each procedure declares the ONE permission it requires. The actor's
 * effective permissions are resolved SERVER-SIDE on every call from their role
 * bundle plus their per-user overrides (see permission.service.ts); the client
 * is never consulted and the UI hiding a control is never load-bearing.
 *
 * Resolution is per request, not cached in the session: the JWT fixes the role
 * at sign-in, so a session-cached permission set would leave a revoked
 * permission live until the session expired.
 *
 * The resolved Actor is injected as `ctx.actor` — services take that, never
 * `ctx.session.user`, so data scoping reads the same permission set that
 * authorized the call.
 *
 * Usage: permissionProcedure("tank.manage").mutation(...)
 */
export function permissionProcedure(permission: Permission) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const actor = await buildActor(ctx.db, {
      id: ctx.session.user.id,
      role: ctx.session.user.role,
      siteId: ctx.session.user.siteId ?? null,
      defaultTankId: ctx.session.user.defaultTankId ?? null,
    });

    if (!actor.permissions.has(permission)) {
      ctx.logger.warn(
        { userId: actor.id, role: actor.role, permission },
        "Forbidden: actor lacks required permission",
      );
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    return next({ ctx: { ...ctx, actor } });
  });
}
