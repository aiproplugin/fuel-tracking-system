import { z } from "zod";

/**
 * Server-side environment validation. Imported only from server code
 * (never from client components or the edge middleware).
 *
 * Fails fast at startup with the names (never the values) of the
 * missing/invalid variables.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be at least 32 characters"),
  NEXTAUTH_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Drivers are fully modeled but their reports stay hidden until this flag is
   * turned on — no migration required (CLAUDE.md). Accepts "true"/"1" (any
   * case); anything else (or unset) is false.
   */
  FEATURE_DRIVER_REPORTS: z
    .string()
    .optional()
    .transform((value) => value?.toLowerCase() === "true" || value === "1"),
});

function loadEnv(): z.infer<typeof serverEnvSchema> {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const invalidKeys = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new Error(
      `Invalid or missing environment variables: ${invalidKeys}. ` +
        "Copy .env.example to .env and fill in real values (see README.md).",
    );
  }
  return parsed.data;
}

export const env = loadEnv();
