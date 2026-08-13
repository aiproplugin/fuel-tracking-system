import { z } from "zod";
import { PERMISSIONS, ROLES } from "@/lib/permissions";
import { idSchema } from "@/lib/schemas/master-data";
import { strictObject } from "@/lib/validation";

/**
 * Server-side input schemas for access management. Built on strictObject so
 * unknown fields are rejected, and on the catalogue itself so an unknown
 * permission string can never reach the database.
 */

/** Derived from the catalogue: a retired key stops validating immediately. */
export const permissionSchema = z.enum(PERMISSIONS);
export const roleNameSchema = z.enum(ROLES);
export const overrideModeSchema = z.enum(["GRANT", "DENY"]);

/**
 * A reason is REQUIRED on every access change — the audit trail must say why,
 * not merely what. Bounded to the reason column's width.
 */
export const reasonSchema = z
  .string()
  .trim()
  .min(4, "Give a reason for this access change")
  .max(500, "Reason is too long");

export const userAccessSchema = strictObject({ userId: idSchema });

export const setPermissionOverrideSchema = strictObject({
  userId: idSchema,
  permission: permissionSchema,
  mode: overrideModeSchema,
  reason: reasonSchema,
});

export const removePermissionOverrideSchema = strictObject({
  userId: idSchema,
  permission: permissionSchema,
  reason: reasonSchema,
});

export const changeRoleSchema = strictObject({
  userId: idSchema,
  role: roleNameSchema,
  reason: reasonSchema,
});
