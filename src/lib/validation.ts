import { z } from "zod";

/**
 * Central Zod helpers. ALL server-side input schemas must be built with
 * these so that unknown fields are rejected everywhere (client-side
 * validation is UX only and never trusted).
 */

/** Object schema that rejects unknown keys — the default for all API input. */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

/** Usernames: 3–64 chars, letters/digits/dot/underscore/hyphen only. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(64, "Username must be at most 64 characters")
  .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, digits, and . _ -");

/**
 * Strong password policy for CREATING/CHANGING passwords (Phase 1 user
 * management). Login only checks presence — policy errors at login would
 * leak information about account existence and rules.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a digit")
  .regex(/[^a-zA-Z0-9]/, "Password must contain a symbol");

/**
 * Login form input. Intentionally NOT strict and NOT policy-enforcing:
 * Auth.js injects extra fields (csrfToken, callbackUrl) into the
 * credentials payload, and login must fail generically.
 */
export const loginInputSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/** Change-own-password input: current is presence-only, new is policy-checked. */
export const changePasswordSchema = strictObject({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
