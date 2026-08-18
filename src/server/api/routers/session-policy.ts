import { updateSessionPoliciesSchema } from "@/lib/schemas/session-policy";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  getSessionPolicies,
  updateSessionPolicies,
} from "@/server/services/session-policy.service";

/**
 * Per-role session timeouts.
 *
 * Gated on `permission.manage` rather than a new permission of its own: it is a
 * META-PERMISSION, so invariant #2 in src/lib/permissions.ts locks it to the
 * ADMIN role and makes it impossible to hand out via a per-user override. A
 * dedicated `session.manage` would be override-grantable, which is the wrong
 * property for the control that governs how long every session lives.
 */
export const sessionPolicyRouter = createTRPCRouter({
  getSettings: permissionProcedure("permission.manage").query(() => getSessionPolicies()),
  updateSettings: permissionProcedure("permission.manage")
    .input(updateSessionPoliciesSchema)
    .mutation(({ ctx, input }) => updateSessionPolicies(ctx.actor.id, input)),
});
