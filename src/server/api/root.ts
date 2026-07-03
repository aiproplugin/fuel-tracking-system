import { adjustmentsRouter } from "@/server/api/routers/adjustments";
import { auditRouter } from "@/server/api/routers/audit";
import { authRouter } from "@/server/api/routers/auth";
import { dashboardRouter } from "@/server/api/routers/dashboard";
import { deliveriesRouter } from "@/server/api/routers/deliveries";
import { fuelIssuesRouter } from "@/server/api/routers/fuel-issues";
import { healthRouter } from "@/server/api/routers/health";
import { reconciliationRouter } from "@/server/api/routers/reconciliation";
import { qrTokensRouter } from "@/server/api/routers/qr-tokens";
import { sitesRouter } from "@/server/api/routers/sites";
import { tanksRouter } from "@/server/api/routers/tanks";
import { usersRouter } from "@/server/api/routers/users";
import { vehicleTypesRouter } from "@/server/api/routers/vehicle-types";
import { vehiclesRouter } from "@/server/api/routers/vehicles";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

/**
 * Primary application router. Phase 3+ adds: fuelIssues, deliveries,
 * adjustments, reports.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
  auth: authRouter,
  dashboard: dashboardRouter,
  fuelIssues: fuelIssuesRouter,
  deliveries: deliveriesRouter,
  adjustments: adjustmentsRouter,
  reconciliation: reconciliationRouter,
  sites: sitesRouter,
  tanks: tanksRouter,
  vehicles: vehiclesRouter,
  vehicleTypes: vehicleTypesRouter,
  users: usersRouter,
  qrTokens: qrTokensRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (used by server components and tests). */
export const createCaller = createCallerFactory(appRouter);
