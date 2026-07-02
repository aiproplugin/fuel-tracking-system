# Service layer (placeholder — populated from Phase 1 onward)

ALL business rules live here, and ONLY here:

- Every fuel-quantity change (issue, delivery, adjustment) runs inside ONE
  atomic Prisma transaction and writes exactly one `stock_movement` ledger row
  with `balance_after`.
- Hard blocks: fuel-type mismatch, odometer regression (admin-only override).
- Idempotency-key dedupe for fuel submissions.
- Efficiency (km/L) calculation and abnormal-consumption flagging.
- Audit-log writes for every sensitive action.

tRPC routers (`src/server/api`) stay thin: validate input (Zod), check
authorization, call a service, map errors. Services are the unit-test surface.

Planned modules: `fuel-issue.service.ts`, `delivery.service.ts`,
`adjustment.service.ts`, `stock-ledger.service.ts`, `reconciliation.service.ts`,
`qr-token.service.ts`, `audit.service.ts`, `user.service.ts`.
