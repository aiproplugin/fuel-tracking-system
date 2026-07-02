# Security

> Stub — the living security document. Updated every phase; fully audited in Phase 7.

## Implemented in Phase 0

- **Security headers** (`src/middleware.ts`): Content-Security-Policy,
  X-Frame-Options=DENY, X-Content-Type-Options=nosniff,
  Referrer-Policy=strict-origin-when-cross-origin, Permissions-Policy
  (camera restricted to same origin for the QR scanner),
  Strict-Transport-Security in production.
- **Session cookie hardening** (`src/server/auth/config.ts`): httpOnly,
  SameSite=strict, Secure when NEXTAUTH_URL is https, JWT sessions capped at
  8 h with 15-minute rotation.
- **Password hashing** (`src/server/auth/password.ts`): argon2id,
  OWASP-recommended parameters (19 MiB, t=2, p=1).
- **Generic login errors**: the Credentials stub and the login form always
  surface "Invalid username or password" — no user enumeration.
- **Central input validation** (`src/lib/validation.ts`): `strictObject`
  rejects unknown fields; strong password policy schema ready for Phase 1.
- **Env hygiene**: `src/lib/env.ts` fails fast, reporting variable NAMES only;
  `.env` git-ignored and read-denied to tooling in `.claude/settings.json`;
  `.env.example` ships placeholders only.
- **Log hygiene** (`src/lib/logger.ts`): Pino redaction of passwords, tokens,
  secrets, auth headers; correlation-ID child loggers.
- **Error handling**: tRPC error formatter exposes field-level Zod issues
  only; full errors stay in server logs.
- **Dev DB**: docker-compose binds PostgreSQL to 127.0.0.1 only.
- **Dependencies**: exact version pins in `package.json`.

## Known gaps / roadmap

| Item                                                                                                                                                                                                                                                                  | Phase |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Real credential verification, lockout/backoff after failed logins                                                                                                                                                                                                     | 1     |
| Role + ownership checks on every procedure (authz middleware)                                                                                                                                                                                                         | 1     |
| Append-only `audit_log` (logins, overrides, adjustments, assignments)                                                                                                                                                                                                 | 1+    |
| Rate limiting: login, manual QR token entry, fuel submission                                                                                                                                                                                                          | 2–3   |
| CSP without `'unsafe-inline'` for scripts (nonce-based)                                                                                                                                                                                                               | 7     |
| `npm audit` in CI; dependency review                                                                                                                                                                                                                                  | 7     |
| Known advisories against the Next.js **14.x line** (fixes only in Next 16) and dev-only `glob` CLI (via `eslint-config-next`). Accepted for now: internal network, no `remotePatterns` image config, no i18n middleware. Re-evaluate a Next major upgrade in Phase 7. | 7     |
| Least-privilege production DB grants + HTTPS reverse proxy on Windows Server                                                                                                                                                                                          | 7     |

## Threat-model notes (running list)

- QR tokens are opaque and stored in their own table; a leaked token reveals
  nothing about the vehicle and can be rotated without history loss.
- Odometer overrides are ADMIN-only, reason-required, and audit-logged.
- Idempotency keys prevent double-issue on retries/double-taps.
- No PII in URLs, query strings, or logs.
