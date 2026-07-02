import pino from "pino";

/**
 * Application-wide structured logger.
 *
 * - Secrets and credentials are redacted defensively by key name so an
 *   accidentally logged object can never leak them.
 * - JSON output in every environment; pipe through a pretty-printer locally
 *   if desired. No worker-thread transports (they are fragile under the
 *   Next.js server bundle).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "secret",
      "*.secret",
      "authorization",
      "cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "DATABASE_URL",
      "NEXTAUTH_SECRET",
    ],
    censor: "[REDACTED]",
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Child logger carrying a correlation ID so every log line of one request
 * can be traced end to end.
 */
export function createRequestLogger(correlationId: string) {
  return logger.child({ correlationId });
}
