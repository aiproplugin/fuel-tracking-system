import { adjustmentsRouter } from "@/server/api/routers/adjustments";
import { auditRouter } from "@/server/api/routers/audit";
import { authRouter } from "@/server/api/routers/auth";
import { companiesRouter } from "@/server/api/routers/companies";
import { quotasRouter } from "@/server/api/routers/quotas";
import { dashboardRouter } from "@/server/api/routers/dashboard";
import { deliveriesRouter } from "@/server/api/routers/deliveries";
import { fuelIssuesRouter } from "@/server/api/routers/fuel-issues";
import { healthRouter } from "@/server/api/routers/health";
import { permissionsRouter } from "@/server/api/routers/permissions";
import { reconciliationRouter } from "@/server/api/routers/reconciliation";
import { reportsRouter } from "@/server/api/routers/reports";
import { qrTokensRouter } from "@/server/api/routers/qr-tokens";
import { sessionPolicyRouter } from "@/server/api/routers/session-policy";
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
  reports: reportsRouter,
  companies: companiesRouter,
  quotas: quotasRouter,
  sites: sitesRouter,
  tanks: tanksRouter,
  vehicles: vehiclesRouter,
  vehicleTypes: vehicleTypesRouter,
  users: usersRouter,
  qrTokens: qrTokensRouter,
  audit: auditRouter,
  permissions: permissionsRouter,
  sessionPolicy: sessionPolicyRouter,
});

export type AppRouter = typeof appRouter;

/** Server-side caller (used by server components and tests). */
export const createCaller = createCallerFactory(appRouter);
