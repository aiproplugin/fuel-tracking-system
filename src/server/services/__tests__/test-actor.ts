import { ROLE_DEFAULTS, type Permission, type RoleName } from "@/lib/permissions";
import type { Actor } from "@/server/services/actor";

/**
 * Build a test Actor carrying a role's DEFAULT permissions — i.e. a user with
 * no overrides, which is every user immediately after the RBAC migration.
 *
 * Service tests that use this are therefore asserting PRE-RBAC behaviour: if
 * one starts failing, the permission model has changed what a plain role can
 * do. Pass `permissions` explicitly to model an overridden user.
 */
export function testActor(
  role: RoleName,
  overrides: Partial<Omit<Actor, "role" | "permissions">> & {
    permissions?: readonly Permission[];
  } = {},
): Actor {
  const { permissions, ...rest } = overrides;
  return {
    id: "user-1",
    role,
    siteId: null,
    defaultTankId: null,
    permissions: new Set(permissions ?? ROLE_DEFAULTS[role]),
    ...rest,
  };
}
