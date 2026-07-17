import {
  bulkAssignQuotaSchema,
  grantTopUpSchema,
  issueOverrideCodeSchema,
  quotaStatusSchema,
  resolveVehicleQuotaSchema,
  setCompanyQuotaSchema,
  setVehicleQuotaSchema,
  setVehicleTypeQuotaSchema,
  updateQuotaSettingsSchema,
} from "@/lib/schemas/quota";
import { adminProcedure, createTRPCRouter, supervisorProcedure } from "@/server/api/trpc";
import {
  bulkAssignQuota,
  getQuotaSettings,
  getQuotaStatus,
  grantTopUp,
  issueOverrideCode,
  resolveVehicleQuotaDetail,
  setCompanyQuota,
  setVehicleQuota,
  setVehicleTypeQuota,
  updateQuotaSettings,
} from "@/server/services/quota.service";

/**
 * Quota management + status. Configuration is ADMIN-only; issuing an
 * override code is the one SUPERVISOR+ mutation (authorising an over-quota
 * fill at the pump); the status view is SUPERVISOR+ (site-scoped in the
 * service).
 */
export const quotasRouter = createTRPCRouter({
  getSettings: adminProcedure.query(() => getQuotaSettings()),
  updateSettings: adminProcedure
    .input(updateQuotaSettingsSchema)
    .mutation(({ ctx, input }) => updateQuotaSettings(ctx.session.user.id, input)),

  setCompanyQuota: adminProcedure
    .input(setCompanyQuotaSchema)
    .mutation(({ ctx, input }) => setCompanyQuota(ctx.session.user.id, input)),
  setVehicleTypeQuota: adminProcedure
    .input(setVehicleTypeQuotaSchema)
    .mutation(({ ctx, input }) => setVehicleTypeQuota(ctx.session.user.id, input)),
  setVehicleQuota: adminProcedure
    .input(setVehicleQuotaSchema)
    .mutation(({ ctx, input }) => setVehicleQuota(ctx.session.user.id, input)),
  bulkAssign: adminProcedure
    .input(bulkAssignQuotaSchema)
    .mutation(({ ctx, input }) => bulkAssignQuota(ctx.session.user.id, input)),

  grantTopUp: adminProcedure
    .input(grantTopUpSchema)
    .mutation(({ ctx, input }) => grantTopUp(ctx.session.user.id, input)),
  issueOverrideCode: supervisorProcedure
    .input(issueOverrideCodeSchema)
    .mutation(({ ctx, input }) => issueOverrideCode(ctx.session.user, input)),

  status: supervisorProcedure
    .input(quotaStatusSchema)
    .query(({ ctx, input }) => getQuotaStatus(ctx.session.user, input)),
  resolveVehicle: adminProcedure
    .input(resolveVehicleQuotaSchema)
    .query(({ input }) => resolveVehicleQuotaDetail(input)),
});
