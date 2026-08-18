import { z } from "zod";
import { ROLES } from "@/lib/permissions";
import { validateIdleMinutes } from "@/lib/session-policy";
import { strictObject } from "@/lib/validation";

/**
 * Session-policy input. The bounds are NOT restated here — every entry is
 * checked by validateIdleMinutes() from the catalogue module, so the schema and
 * the service can never drift apart on what "5–120 for privileged roles" means.
 *
 * The payload always carries ALL roles: a partial save could silently leave a
 * role on a stale value, and "the admin saw every timeout when they saved" is a
 * property worth having in the audit before/after.
 */

export const roleNameSchema = z.enum(ROLES);

export const sessionPolicyEntrySchema = strictObject({
  role: roleNameSchema,
  /** Minutes of inactivity before sign-out; null = persistent (operator only). */
  idleMinutes: z.number().int().nullable(),
}).superRefine((entry, ctx) => {
  const error = validateIdleMinutes(entry.role, entry.idleMinutes);
  if (error !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["idleMinutes"], message: error });
  }
});

export const updateSessionPoliciesSchema = strictObject({
  policies: z.array(sessionPolicyEntrySchema),
}).superRefine((input, ctx) => {
  const seen = new Set(input.policies.map((policy) => policy.role));
  if (seen.size !== input.policies.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policies"],
      message: "Each role may appear only once.",
    });
    return;
  }
  const missing = ROLES.filter((role) => !seen.has(role));
  if (missing.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policies"],
      message: `Every role must be included. Missing: ${missing.join(", ")}.`,
    });
  }
});

export type UpdateSessionPoliciesInput = z.infer<typeof updateSessionPoliciesSchema>;
