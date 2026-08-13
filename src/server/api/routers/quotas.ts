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
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
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
 * Quota management + status. Configuration needs quota.manage; authorising an
 * over-quota fill at the pump is a separate, weaker permission
 * (quota.override.authorise); the status view is site-scoped in the service.
 */
export const quotasRouter = createTRPCRouter({
  getSettings: permissionProcedure("quota.manage").query(() => getQuotaSettings()),
  updateSettings: permissionProcedure("quota.manage")
    .input(updateQuotaSettingsSchema)
    .mutation(({ ctx, input }) => updateQuotaSettings(ctx.actor.id, input)),

  setCompanyQuota: permissionProcedure("quota.manage")
    .input(setCompanyQuotaSchema)
    .mutation(({ ctx, input }) => setCompanyQuota(ctx.actor.id, input)),
  setVehicleTypeQuota: permissionProcedure("quota.manage")
    .input(setVehicleTypeQuotaSchema)
    .mutation(({ ctx, input }) => setVehicleTypeQuota(ctx.actor.id, input)),
  setVehicleQuota: permissionProcedure("quota.manage")
    .input(setVehicleQuotaSchema)
    .mutation(({ ctx, input }) => setVehicleQuota(ctx.actor.id, input)),
  bulkAssign: permissionProcedure("quota.manage")
    .input(bulkAssignQuotaSchema)
    .mutation(({ ctx, input }) => bulkAssignQuota(ctx.actor.id, input)),

  grantTopUp: permissionProcedure("quota.manage")
    .input(grantTopUpSchema)
    .mutation(({ ctx, input }) => grantTopUp(ctx.actor.id, input)),
  issueOverrideCode: permissionProcedure("quota.override.authorise")
    .input(issueOverrideCodeSchema)
    .mutation(({ ctx, input }) => issueOverrideCode(ctx.actor, input)),

  status: permissionProcedure("quota.view")
    .input(quotaStatusSchema)
    .query(({ ctx, input }) => getQuotaStatus(ctx.actor, input)),
  resolveVehicle: permissionProcedure("quota.manage")
    .input(resolveVehicleQuotaSchema)
    .query(({ input }) => resolveVehicleQuotaDetail(input)),
});
