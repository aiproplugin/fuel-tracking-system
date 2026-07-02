# Architecture

> Stub — expanded each phase. Phase 0 documents the skeleton.

## Layering (strict, enforced everywhere)

```
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

## Conventions

- Store timestamps in UTC; render in Asia/Colombo (UTC+5:30).
- Naming: `snake_case` DB columns ↔ `camelCase` TS via Prisma `@map` (Phase 1).
- Services carry JSDoc and are the primary unit-test surface.
- Roles: OPERATOR, SUPERVISOR, MANAGER, ADMIN — enforced by tRPC middleware,
  never by the client.
