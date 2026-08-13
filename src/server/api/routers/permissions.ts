import {
  changeRoleSchema,
  removePermissionOverrideSchema,
  setPermissionOverrideSchema,
  userAccessSchema,
} from "@/lib/schemas/permissions";
import { createTRPCRouter, permissionProcedure } from "@/server/api/trpc";
import {
  changeUserRole,
  getUserAccess,
  listUserAccess,
  removePermissionOverride,
  setPermissionOverride,
} from "@/server/services/permission.service";

/**
 * Access management. `permission.manage` is a META-PERMISSION reserved to the
 * ADMIN role — it can never be granted by an override, so holding it is proof
 * the actor is an admin. Every mutation re-validates the resulting end state
 * against the security invariants in the service, so no request shape can
 * produce an unsafe permission set.
 */
export const permissionsRouter = createTRPCRouter({
  listUsers: permissionProcedure("permission.manage").query(() => listUserAccess()),

  userAccess: permissionProcedure("permission.manage")
    .input(userAccessSchema)
    .query(({ input }) => getUserAccess(input.userId)),

  setOverride: permissionProcedure("permission.manage")
    .input(setPermissionOverrideSchema)
    .mutation(({ ctx, input }) => setPermissionOverride(ctx.actor, input)),

  removeOverride: permissionProcedure("permission.manage")
    .input(removePermissionOverrideSchema)
    .mutation(({ ctx, input }) => removePermissionOverride(ctx.actor, input)),

  changeRole: permissionProcedure("permission.manage")
    .input(changeRoleSchema)
    .mutation(({ ctx, input }) => changeUserRole(ctx.actor, input)),
});
