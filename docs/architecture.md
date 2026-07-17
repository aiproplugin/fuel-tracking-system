# Architecture

> Expanded each phase. Phase 1 adds the data model and hardened auth.

## Layering (strict, enforced everywhere)

```text
UI (src/app, React Server + Client Components)
  └─> tRPC routers (src/server/api)        — input validation (Zod), authz middleware
        └─> Services (src/server/services)  — ALL business rules + ledger writes
              └─> Prisma (src/server/db)    — the only module touching PostgreSQL
```

- Clients NEVER touch the DB directly.
- Every fuel-quantity change runs through the service layer inside ONE atomic
  Prisma transaction and writes exactly one `stock_movement` ledger row.
- `tank.current_stock` is a cache of the latest movement's `balance_after`;
  a reconciliation check verifies the invariant (Phase 4).

## Phase 0 skeleton

| Concern          | Location                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Design tokens    | `tailwind.config.ts` (ported from `docs/fuel-ui-prototype.html`) |
| UI primitives    | `src/components/ui` (Button, Input, Badge)                       |
| Auth (stub)      | `src/server/auth` (Auth.js v5 Credentials, argon2id helpers)     |
| tRPC pipeline    | `src/server/api` + `src/app/api/trpc/[trpc]/route.ts`            |
| DB singleton     | `src/server/db/index.ts` (no models yet)                         |
| Env validation   | `src/lib/env.ts`                                                 |
| Logger           | `src/lib/logger.ts` (Pino, secret redaction, correlation IDs)    |
| Security headers | `src/middleware.ts`                                              |

## Data model (Phase 1)

Tables (snake_case; the Prisma model is the source of truth in `prisma/schema.prisma`):

- **site** — physical location; supervisors are scoped to one.
- **app_user** — username (stored lowercase), argon2id `password_hash`, role,
  `default_tank_id` (operator binding), `site_id`, `failed_login_count` +
  `locked_until` (lockout state).
- **tank** — fuel type, capacity, `current_stock` (cache of the latest ledger
  `balance_after`), low-stock threshold.
- **vehicle_type** — the meter type (`DISTANCE` km / `HOURS` hrs / `ENERGY`
  kWh) and the per-type min/max efficiency abnormal-consumption band, in the
  type's own unit per litre (km/L, hrs/L, kWh/L).
- **vehicle** — unique plate, type, fuel type, cached `current_meter`
  (reading in the type's meter unit).
- **driver** — optional everywhere; reports hidden until enabled.
- **qr_token** — opaque random token per vehicle in its own table; rotation =
  deactivate + insert, vehicle history untouched.
- **fuel_transaction** — liters, meter reading + previous, unique
  `idempotency_key`, override fields (admin-only), `efficiency`
  (output per litre; null on first fill), `is_abnormal`, hidden
  `unit_cost`, backdatable
  `issued_at`.
- **delivery**, **stock_adjustment** — headers for the other movement kinds.
- **stock_movement** — THE LEDGER. Append-only, BigInt autoincrement id =
  strict insertion order, signed quantity, `balance_after`, exactly one FK to
  its source record (fuel_transaction / delivery / adjustment).
- **meter_exception** — operator-flagged blocked entries, ADMIN review
  workflow (PENDING/APPROVED/REJECTED).
- **audit_log** — append-only actor/action/entity/before/after/IP.

### Auth flow (Phase 1)

1. Login form → Auth.js Credentials → rate limiter (IP+username, in-memory)
   → `user.service.verifyUserCredentials`: normalize username, timing-equalized
   argon2id verify, lockout policy (5 failures → 15 min, exponential backoff),
   audit logging. Every failure mode returns the same generic error.
2. JWT callbacks bind `role`, `defaultTankId`, `siteId` into the session for
   its lifetime (reassignment requires a new login).
3. tRPC `protectedProcedure` requires a session; `roleProcedure([...])` gates
   by explicit role allowlist (no implicit hierarchy — e.g. adjustments are
   SUPERVISOR+ADMIN but not MANAGER). Data scoping happens in services.

## Admin console (Phase 2)

- `src/app/admin/*` under a server-guarded layout (SUPERVISOR+); the 248px
  dark sidebar (`SidebarNav`) filters items by role. Pages are thin server
  components rendering client components that call tRPC hooks.
- Master-data flow: client → router (role gate + strict Zod) → service
  (business rules + audit) → Prisma. Supervisor site-scoping lives in
  `src/server/services/actor.ts` and is applied inside services.
- The brand mark renders exclusively through `src/components/brand/logo.tsx`
  (single source of truth for `public/logo.png`).
- QR print sheets live OUTSIDE the admin layout (`src/app/print/qr/[vehicleId]`)
  so printed output is chrome-free; access is ADMIN-only.

## Fuel entry core (Phase 3)

- `fuel-issue.service.ts` owns every fuel-quantity write. One `$transaction`
  per issue: fuel_transaction + exactly one stock_movement (signed quantity,
  `balance_after`) + tank/vehicle cache updates. Concurrency: a guarded
  decrement (`updateMany where currentStock >= liters`) serializes on the
  tank row — an emptied tank yields INSUFFICIENT_STOCK, never a negative
  ledger balance.
- Business blocks are a typed result union (`SUCCESS | FUEL_TYPE_MISMATCH |
METER_BLOCKED | INSUFFICIENT_STOCK`), mapped by the client state machine
  (`scan-flow.tsx`) to the M4–M7 prototype screens. Idempotency-key replays
  return the original receipt; a concurrent duplicate falls back through the
  unique-key violation to the same replay path.
- Exception path: M6 flag -> PENDING meter_exception (carries liters) ->
  D6 ADMIN review. APPROVE completes the issue as an audited override
  transaction (the fuel physically left the tank when dispensed); REJECT
  writes nothing to the ledger.
- The tank is never an API input: operator procedures read the binding from
  the session JWT, set at login by an ADMIN assignment.

## Deliveries, adjustments, reconciliation (Phase 4)

- `delivery.service.ts` / `adjustment.service.ts` mirror the fuel-issue
  pattern: strict schemas, idempotency-key replay, typed result unions
  (OVER_CAPACITY / INSUFFICIENT_STOCK), one atomic $transaction writing the
  header + exactly one signed movement + cache, guarded updates for
  capacity/floor race-safety.
- `reconciliation-core.ts` is pure (no I/O, no path aliases) so both the
  service and `scripts/reconcile.ts` (tsx CLI) share the same chain-replay
  math. The CLI exits 1 on mismatch for scheduled-task monitoring;
  `--repair` resyncs cache drift only — broken chains are never auto-fixed.
- The D1 reconciliation panel on `/admin` renders a fresh run server-side.

## Conventions

- Store timestamps in UTC; render in Asia/Colombo (UTC+5:30).
- Naming: `snake_case` DB columns ↔ `camelCase` TS via Prisma `@map` (Phase 1).
- Services carry JSDoc and are the primary unit-test surface.
- Roles: OPERATOR, SUPERVISOR, MANAGER, ADMIN — enforced by tRPC middleware,
  never by the client.
