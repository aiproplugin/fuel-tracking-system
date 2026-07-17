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
  SETTINGS_CHANGED (meter type + efficiency band before/after), QR_TOKEN created/rotated/
  deactivated. Password hashes and plaintext never enter audit payloads
  (covered by test).
- **Operational safety rails**: the last active ADMIN cannot be demoted or
  deactivated; tank fuel type is immutable after creation; vehicle meter
  readings are not editable through CRUD (only fuel issues / exception
  review); a vehicle type's meter type is locked once its vehicles have
  recorded history; operators changing role lose their tank binding.
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
  only — mismatch, meter regression, stock, liters bounds, vehicle/tank
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
- **Override authority**: only ADMIN can approve a corrected meter reading;
  approval is double-guarded (status + stock) inside one transaction and
  audited as METER_OVERRIDE + METER_EXCEPTION_REVIEWED with the
  mandatory reason.
- **Audit**: FUEL_ISSUED on every recorded issue;
  METER_EXCEPTION_FLAGGED on operator flags.

## Implemented in Phase 4

- **Delivery entry is SUPERVISOR (own site) or ADMIN only — deliberately no
  operator path.** Rationale: deliveries INCREASE stock, so a fabricated
  delivery can mask fuel diversion indefinitely (issue the stolen fuel,
  "deliver" it back on paper). Issues are self-limiting — they drain the
  tank and surface at the next physical count — which makes inbound
  movements a strictly higher control risk than outbound ones. Segregating
  duties (operators issue, supervisors/admins receive) keeps one person
  from controlling both sides of the ledger.
- **Adjustments**: SUPERVISOR (own site) or ADMIN, mandatory audited
  reason; MANAGER is excluded from BOTH writes (explicit allowlists) and
  reads registers only.
- **Guards on every inbound/correction write** (same guarded-update
  pattern as issues, no raw SQL): deliveries cannot exceed tank capacity;
  adjustments cannot drive stock negative or over capacity; delivery
  backdating capped at 31 days, future timestamps rejected.
- **Idempotency extended to deliveries and adjustments** (unique
  client-minted keys; replay returns the original record) — a double-click
  can no longer inflate stock.
- **Reconciliation**: `npm run reconcile` replays every tank's full
  movement chain (`balance_after[i] = balance_after[i-1] + quantity[i]`)
  and compares the cache; exit code 1 on mismatch (schedulable). Cache
  drift is repairable (`--repair` / ADMIN tRPC, audited as TANK_UPDATED);
  a broken chain is NEVER auto-repaired — that means ledger rows are
  inconsistent and demands investigation.
- Audit: DELIVERY_RECORDED, ADJUSTMENT_RECORDED, TANK_UPDATED (cache
  repair with before/after).

## Implemented in Phase 5

- **Dashboards, KPIs, and alerts are read-only and server-scoped.** Every
  dashboard query resolves the actor's role/site server-side; supervisors see
  their own site, managers/admins see all. No dashboard path writes to the
  ledger. The reconciliation panel and exception queue surface state read-only.
- **No new mutation surface** was introduced — alerts (low stock, meter
  exceptions, abnormal consumption) are derived from existing ledger data, so
  no additional authorization boundary was added.

## Implemented in Phase 6

- **Exports re-run the report server-side.** The CSV/XLSX download route
  (`src/app/api/reports/export/route.ts`) re-executes the same scoped report
  service; the browser only carries the current **filter selection** in the
  query string, never assembled rows. There is no client-trusted data path into
  an export.
- **Same scoping on screen and in files.** On-screen figures and exports read
  one source and apply identical site scoping and the driver-report gate — all
  enforced server-side, not by hiding UI.
- **CSV formula-injection defence** (`src/server/services/reports/csv.ts`):
  cells beginning with `=`, `+`, `-`, `@`, tab, or CR are prefixed with a quote
  so spreadsheets never evaluate report data as a formula; RFC-4180 quoting and
  a UTF-8 BOM otherwise.
- **No PII in export URLs** — only opaque IDs and date filters travel in the
  query string; the plate/vehicle data lives in the response body.

## Implemented in Phase 7

- **Nonce-based CSP; `'unsafe-inline'` removed from `script-src`**
  (`src/middleware.ts`): production emits
  `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'`. A fresh Web-Crypto
  nonce is minted per request and set on both the request headers (so Next.js
  stamps it onto its framework scripts) and the response header. `'self'`
  remains only as a CSP2 fallback; `'strict-dynamic'` supersedes it in modern
  browsers. Development keeps a permissive `script-src` (HMR/dev-overlay use
  eval and un-nonced inline scripts). `style-src` still allows inline (Next/
  Tailwind inject un-nonced styles; lower risk, out of scope here). A
  header-presence test locks the production shape.
- **Audit IP on every event via AsyncLocalStorage**
  (`src/server/context/request-context.ts`): the tRPC route handler and the
  export route bind the request's client IP (`x-forwarded-for` → `x-real-ip`)
  into an async-local store; `recordAuditEvent` fills `ipAddress` from it
  automatically, so business events (overrides, adjustments, deliveries, QR/user
  admin, settings) are attributed to an IP — not just login/lockout. The
  credentials flow still passes IP explicitly (it runs outside the tRPC
  binding). IP is used only for attribution, never for authorization.
- **Report exports are rate-limited and audited**: `exportRateLimiter`
  (20 / 5 min per user) guards `/api/reports/export` (429 + `Retry-After`), and
  every successful export writes a **`REPORT_EXPORTED`** audit row (actor,
  format, row count, requested filters — no row data/PII). New `AuditAction`
  enum value + migration `20260704120000_phase7_report_exported_audit`.
- **Security test suite**:
  - _Authz matrix_ (`authz-matrix.test.ts`) drives **every** procedure in the
    real `appRouter` (dashboard/reports/fuel/admin/…) as each role and asserts
    the exact allow/deny, and **locks the procedure set** — a new procedure
    fails the build until its required role is declared.
  - _Export security contract_ (`export-route.test.ts`): 401/403 (incl.
    `mustChangePassword` and OPERATOR), 429 when rate-limited, and — on success —
    the `Actor` is built from the **session** (a spoofed `siteId` query param is
    ignored) and `REPORT_EXPORTED` is recorded.
  - _Audit-coverage lock_ (`audit-coverage.test.ts`): asserts every
    `AuditAction` enum value is actually emitted somewhere in the server/app
    source — deleting an audit call fails the build.
  - _Header presence_ (`middleware-headers.test.ts`): CSP nonce present and
    **no `'unsafe-inline'` in `script-src`** in production, plus HSTS/
    X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy.
- **Deployment runbook** ([deployment.md](deployment.md)): least-privilege
  `fuel_app` owner **plus a concrete split `fuel_runtime` role** (SELECT/INSERT/
  UPDATE only — no DELETE/DDL, with `ALTER DEFAULT PRIVILEGES` for future
  tables), localhost-only PostgreSQL with `scram-sha-256`, HTTPS reverse proxy
  (required for the camera), firewall rules keeping app/DB ports local, backups,
  scheduled reconciliation, and a post-deploy security checklist.
- **Dependency review**: `npm audit` output triaged below; run it in CI on every
  install.
- **End-user guides** ([guides/](guides/)) explain how the controls surface in
  practice (forced password change, generic login errors, lockout, ADMIN-only
  overrides/tank assignment, append-only audit trail).

## Dependency audit (Phase 7)

Run `npm audit` on every CI install and review new advisories. Snapshot at this
release: **7 advisories (4 high, 3 moderate); 4 reach runtime deps.** Every
proposed fix is a **major** version bump (`next@16`, `eslint-config-next@16`, or
a nonsensical `exceljs@3.4` downgrade), so all are triaged and accepted for this
internal release rather than force-upgraded. Triage:

- **Next.js 14.2.35 line** — a bundle of advisories (DoS via Server Components /
  image optimizer, request smuggling in rewrites, i18n middleware bypass, cache
  poisoning, SSRF on WebSocket upgrades). Fixes land only in Next 15.5.16+ / 16.
  Accepted for an **internal, authenticated, single-tenant** deployment: no
  `images.remotePatterns`, no i18n middleware, no Pages-Router rewrites, no
  untrusted multi-tenant routing, and (see below) no shared HTML cache. A Next
  major upgrade is scheduled as its own task.
  - **CVE-2026-44581 — XSS in App Router apps using CSP nonces
    (GHSA-ffhc-5mcf-pf4q, moderate).** Directly relevant because Phase 7 adds
    nonce CSP. Affected: `>=13.4.0 <15.5.16`; **14.2.35 is in range** with no
    14.2.x patch. Exploit requires ALL of: (a) nonce CSP, (b) deployment behind
    a **shared cache**, and (c) a **malformed nonce derived from request
    headers** reflected unsafely. Our exposure is minimal because:
    - the nonce is generated **server-side** per request (`crypto.getRandomValues`
      in `src/middleware.ts`), never derived from a client value;
    - the middleware **overwrites** any incoming `Content-Security-Policy` and
      `x-nonce` request headers (`Headers.set`), so a client cannot smuggle a
      malformed nonce into Next's reflection path;
    - the on-prem reverse proxy serves **dynamic, uncached HTML** (no shared
      response cache), so the cache-poisoning vector does not apply.
    Nonce CSP remains a net improvement over the prior `'unsafe-inline'` policy;
    the Next upgrade will close the residual case. Re-verify this control after
    the upgrade.
  - **`postcss <8.5.10` (moderate)** — pulled in via Next's build toolchain
    (`</style>` stringify XSS). Build-time CSS processing of first-party
    stylesheets only; no untrusted CSS input. Cleared by the Next upgrade.
- **`exceljs` → `uuid <11.1.1` (moderate, runtime).** The advisory is a missing
  buffer-bounds check in uuid v3/v5/v6 **only when a caller passes its own `buf`
  argument**. `exceljs` uses `uuid` to mint worksheet IDs **without** a `buf`
  argument, so the vulnerable path is never reached. More importantly, the app
  only ever **writes** workbooks from server-computed report rows and **never
  parses uploaded/untrusted spreadsheets**, so exceljs's parsing surface is not
  exposed at all. npm's suggested "fix" (`exceljs@3.4.0`) is an older major and
  is rejected. Kept pinned; revisit if a fixed `exceljs`/`uuid` ships or if an
  XLSX **import** feature is ever added.
- **Dev-only: `glob` CLI / `@next/eslint-plugin-next` (via
  `eslint-config-next`).** Lint-time tooling; not part of the runtime bundle, so
  no production exposure. Cleared by the `eslint-config-next` major bump when we
  take it.

## Known gaps / roadmap

| Item | When |
| --- | --- |
| Shared rate-limit store if the app is ever scaled beyond one process (in-memory today; fits the single-node on-prem target) | later |
| `style-src` nonce/hash to drop inline styles (scripts already nonce-locked) | later |
| Next.js major upgrade to clear 14.x advisories | later |
| Optional `exceljs` replacement if an XLSX **import** feature is ever added | later |

## Threat-model notes (running list)

- QR tokens are opaque and stored in their own table; a leaked token reveals
  nothing about the vehicle and can be rotated without history loss.
- Meter-reading overrides are ADMIN-only, reason-required, and audit-logged.
- Idempotency keys prevent double-issue on retries/double-taps.
- No PII in URLs, query strings, or logs.
