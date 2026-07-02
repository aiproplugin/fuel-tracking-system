import { authRouter } from "@/server/api/routers/auth";
import { healthRouter } from "@/server/api/routers/health";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

/**
 * Primary application router. Phase 2+ adds: users, tanks, vehicles,
 * fuelIssues, deliveries, adjustments, qrTokens, audit, settings, reports.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (used by server components and tests). */
export const createCaller = createCallerFactory(appRouter);
