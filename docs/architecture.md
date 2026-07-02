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
- **vehicle_type** — the per-type min/max km/L abnormal-consumption band.
- **vehicle** — unique plate, type, fuel type, cached `current_odometer`.
- **driver** — optional everywhere; reports hidden until enabled.
- **qr_token** — opaque random token per vehicle in its own table; rotation =
  deactivate + insert, vehicle history untouched.
- **fuel_transaction** — liters, odometer + previous, unique
  `idempotency_key`, override fields (admin-only), `km_per_liter`
  (null on first fill), `is_abnormal`, hidden `unit_cost`, backdatable
  `issued_at`.
- **delivery**, **stock_adjustment** — headers for the other movement kinds.
- **stock_movement** — THE LEDGER. Append-only, BigInt autoincrement id =
  strict insertion order, signed quantity, `balance_after`, exactly one FK to
  its source record (fuel_transaction / delivery / adjustment).
- **odometer_exception** — operator-flagged blocked entries, ADMIN review
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

## Conventions

- Store timestamps in UTC; render in Asia/Colombo (UTC+5:30).
- Naming: `snake_case` DB columns ↔ `camelCase` TS via Prisma `@map` (Phase 1).
- Services carry JSDoc and are the primary unit-test surface.
- Roles: OPERATOR, SUPERVISOR, MANAGER, ADMIN — enforced by tRPC middleware,
  never by the client.
