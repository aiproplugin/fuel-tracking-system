"use client";

import { useMemo } from "react";
import type { Permission } from "@/lib/permissions";
import { api } from "@/lib/trpc/client";

/**
 * THE client-side permission check.
 *
 * UI controls must be gated on the user's RESOLVED EFFECTIVE PERMISSIONS, never
 * on their base role. Roles are only default bundles: a per-user override can
 * put real access anywhere relative to them, so a role check gets it wrong in
 * both directions — a GRANTED permission would never reveal its control (making
 * the grant useless), and a DENIED one would keep showing a control the server
 * refuses.
 *
 * This is UI VISIBILITY ONLY. Every mutation is independently re-resolved and
 * enforced by permissionProcedure on the server; hiding a control is a
 * convenience, never a security boundary.
 */

/** Fails CLOSED: an unknown answer is "not held", never "held". */
export function hasPermission(
  permissions: readonly Permission[] | undefined | null,
  permission: Permission,
): boolean {
  return permissions?.includes(permission) ?? false;
}

export interface PermissionsResult {
  /** True until the effective permission set has loaded. */
  isLoading: boolean;
  /** Does the signed-in user hold this permission right now? */
  can: (permission: Permission) => boolean;
  /** Everything held, for the rare caller that needs the whole set. */
  permissions: readonly Permission[];
}

export function usePermissions(): PermissionsResult {
  const me = api.auth.me.useQuery();
  const permissions = useMemo(() => me.data?.permissions ?? [], [me.data?.permissions]);
  const held = useMemo(() => new Set(permissions), [permissions]);

  return {
    isLoading: me.isLoading,
    // While loading, `held` is empty and every check is false — controls appear
    // only once access is actually known.
    can: (permission: Permission) => held.has(permission),
    permissions,
  };
}
