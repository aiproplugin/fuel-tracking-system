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

## Implemented in Phase 1

- **Real credential verification** (`src/server/services/user.service.ts`):
  argon2id verify with **timing equalization** — unknown usernames and
  locked/inactive accounts still verify against a dummy hash, so response
  time is uniform across failure modes.
- **Account lockout with exponential backoff**
  (`src/server/auth/lockout-policy.ts`): 5 consecutive failures → 15 min
  lock, doubling per further failure, capped at 24 h; reset on success.
  Locked accounts get the SAME generic error (no lockout oracle).
- **Login rate limiting** (`src/server/security/rate-limit.ts`): sliding
  window, 10 attempts / 5 min per IP+username. In-memory — valid for the
  single-node on-prem target; needs a shared store if ever multi-process
  (Phase 7 review item).
- **Audit trail live for auth**: LOGIN_SUCCESS, LOGIN_FAILURE (actor null
  for unknown usernames — attempted usernames are deliberately NOT stored,
  they may be mistyped passwords), ACCOUNT_LOCKED, LOGIN_RATE_LIMITED,
  LOGOUT. Audit writes never throw (a logging failure must not become an
  auth outage) but failures are logged at error level.
- **Role authorization middleware** (`src/server/api/trpc.ts`):
  `roleProcedure` with explicit allowlists (least privilege — adjustments
  allow SUPERVISOR/ADMIN but not MANAGER), covered by tests.
- **Session binding**: role, default tank, and site are fixed into the JWT
  at login; the client can never change them.
- **Seed hygiene**: initial stock enters through real ledger movements;
  seeded dev passwords satisfy the strong policy and are documented as
  dev-only.

## Implemented in Phase 2

- **Role matrix enforced server-side** on every master-data procedure:
  vehicles/tanks read = SUPERVISOR+ (supervisor scoped to own site via
  `siteScopeWhere` — a supervisor without a site sees nothing, never
  everything); all writes + users/QR tokens/settings = ADMIN only; audit
  read = MANAGER/ADMIN. Sidebar visibility mirrors, but never replaces,
  the tRPC gates.
- **Audit coverage extended**: USER_CREATED/UPDATED, ROLE_CHANGED,
  TANK_ASSIGNED (before/after tank), TANK/VEHICLE/SITE create+update,
  SETTINGS_CHANGED (km/L band before/after), QR_TOKEN created/rotated/
  deactivated. Password hashes and plaintext never enter audit payloads
  (covered by test).
- **Operational safety rails**: the last active ADMIN cannot be demoted or
  deactivated; tank fuel type is immutable after creation; vehicle odometers
  are not editable through CRUD (only fuel issues / exception review);
  operators changing role lose their tank binding.
- **QR tokens**: opaque `FT-<uuid>` in their own table, at most one active
  per vehicle, rotation atomically deactivates the old sheet; the printed
  sheet contains only the token QR + plate text.

## Password management (post-Phase 2 addition)

- **Model: admin sets a TEMPORARY password; the user must replace it at
  first sign-in.** The admin never knows a user's long-term credential.
  Applies to both user creation and the ADMIN "Reset password" action.
- **Server-side enforcement**: a session carrying `mustChangePassword` is
  blocked by `protectedProcedure` (FORBIDDEN) on every procedure except
  `auth.changePassword`; the `/change-password` redirect is UX only.
- **Own-password change**: requires the current password, enforces the
  policy schema, rejects reuse of the current password, rate-limited
  (5 attempts / 15 min per user), then forces re-login for a clean session.
- **Audit**: `PASSWORD_SET` (initial, temporary), `PASSWORD_RESET`
  (admin reset), `PASSWORD_CHANGED` (user's own change). Passwords and
  hashes never appear in audit payloads, logs, or API responses (covered
  by tests).
- **JWT-session caveat**: resetting a password does NOT terminate a target
  user's existing session (JWT strategy has no server-side revocation);
  it remains valid until expiry (max 8 h) or sign-out. Revisit with a
  server-side session store in Phase 7 if instant revocation is required.

## Implemented in Phase 3

- **Server-side re-validation of every fuel rule**: the operator UI is UX
  only — mismatch, odometer regression, stock, liters bounds, vehicle/tank
  activity are all enforced in the service, and the tank always comes from
  the session (schemas reject any client-sent tank as an unknown field).
- **Atomic ledger writes with race-safe stock guard** (no raw SQL): the
  in-transaction guarded decrement makes concurrent submissions serialize on
  the tank row; balances can never go negative.
- **Idempotency**: unique client key per submission; retries and double-taps
  replay the original receipt; cross-operator key reuse is a hard CONFLICT.
- **Rate limits live**: token lookup 30/5 min, manual token entry 10/5 min,
  submission 20/5 min — per operator account.
- **Token hygiene**: scanned tokens stay in client memory (never URLs);
  unknown/inactive tokens return a uniform not-found (no enumeration);
  the plate appears only after a successful active-token match.
- **Override authority**: only ADMIN can approve a corrected odometer;
  approval is double-guarded (status + stock) inside one transaction and
  audited as ODOMETER_OVERRIDE + ODOMETER_EXCEPTION_REVIEWED with the
  mandatory reason.
- **Audit**: FUEL_ISSUED on every recorded issue;
  ODOMETER_EXCEPTION_FLAGGED on operator flags.

## Known gaps / roadmap

| Item                                                                                                                                                                                                                                                                  | Phase |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Ownership/data-scoping checks in services (operator=own tank, supervisor=own site) as those procedures arrive                                                                                                                                                         | 2–3   |
| Audit coverage for overrides, adjustments, role/tank assignment changes (auth events done)                                                                                                                                                                            | 2–4   |
| Rate limiting: manual QR token entry, fuel submission (login done)                                                                                                                                                                                                    | 2–3   |
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
