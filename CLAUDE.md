# CLAUDE.md — Fuel Usage & Stock Tracking System (standing project rules)

Author: Waruna Fonseka (fonsekacws@gmail.com)
Deployment target: on-premise Windows Server on an internal network.
Dev environment: Windows 10 + VS Code + Claude Code. All shell commands must be Windows-compatible.

A high-fidelity UI prototype at `docs/fuel-ui-prototype.html` defines the exact visual design.
Match it precisely; design any missing screen in the same language using the same tokens.

## Stack

Next.js 14 (App Router) + TypeScript (strict) + tRPC + Prisma + PostgreSQL 16 +
Auth.js (NextAuth v5, Credentials provider, argon2id/bcrypt-hashed passwords) + Zod +
Tailwind CSS (PostCSS build, NOT the CDN) + shadcn/ui + Recharts + TanStack Table + Pino.
QR generation via `qrcode`; QR scanning via `html5-qrcode`.

## Architecture (strict layering — enforce everywhere)

UI (`src/app`) -> tRPC routers (`src/server/api`) -> service layer (`src/server/services`: ALL
business rules + ledger writes) -> Prisma (`src/server/db`). Clients NEVER touch the DB directly.
Every fuel-quantity change runs through the service layer inside ONE atomic Prisma transaction.

## Non-negotiable business rules

- **STOCK LEDGER IS SACRED**: every fuel issue, delivery, and adjustment creates exactly one
  `stock_movement` row storing `balance_after`. `tank.current_stock` is a cached value that must
  always equal the latest movement's `balance_after`. Provide a reconciliation command/check.
- **FUEL TYPES**: enum `FuelType { PETROL, DIESEL, KEROSENE }`. Each tank and each vehicle has
  exactly one. A fuel issue is HARD-BLOCKED if `vehicle.fuelType != tank.fuelType` (red mismatch
  screen) — the check is a plain inequality, so it holds for every type and pair. All fuel
  labels and chip variants live ONLY in `src/lib/fuel.ts` (`FUEL_CONFIG`, `FUEL_TYPES`); adding
  a fuel type = one enum value + one config entry (never a `=== "PETROL" ? … : …` ternary).
- **TANK BINDING**: each operator user has `default_tank_id`, bound to session on login. Operator
  never selects a tank. Only ADMIN can assign/reassign an operator's tank.
- **USAGE METER**: every vehicle/asset has ONE monotonically-increasing usage meter whose kind is
  set on the VEHICLE TYPE via `MeterType { DISTANCE (km), HOURS (hrs), ENERGY (kWh) }` — vehicles
  inherit it, there is NO per-vehicle meter type. All unit strings/labels/formatting live ONLY in
  `src/lib/meter.ts` (`METER_CONFIG`); adding a meter type = one enum value + one config entry.
  The meter type is editable in Settings only until vehicles of the type have recorded history.
- **METER READING**: must be >= vehicle's last recorded reading (identical rule for km, hrs, and
  kWh). If lower, BLOCK submission. Only ADMIN may authorize an override (`meter_override=true`,
  reason required, audit-logged). Supervisor and Manager CANNOT override. Operator can only
  "flag for admin review".
- **EFFICIENCY**: `efficiency = (reading_now - reading_previous) / liters_at_previous_fill` —
  ALWAYS output per litre (km/L, hrs/L, kWh/L; higher is better), ONE code path for all meter
  types. First fill has no efficiency (no baseline) — expected, not an error. The inverse form
  (L/hr, L/kWh) is display-only, never stored.
- **ABNORMAL CONSUMPTION**: configurable min/max efficiency bounds PER VEHICLE TYPE (in the
  type's own unit per litre), in settings. Flag a transaction whose efficiency falls outside its
  band (too low or too high).
- **AGGREGATES**: never mix meter types in one figure — fleet efficiency and meter-delta totals
  are computed/reported PER meter type; only litres may total across the whole fleet.
- **IDEMPOTENCY**: every fuel submission carries a client-generated idempotency key; dedupe and
  return the original transaction on retry/double-tap.
- **QR TOKENS**: opaque random UUID-based string in its own `qr_token` table (never the plate,
  never a column on vehicle). Tokens rotate/deactivate without touching vehicle history. Plate
  shown only AFTER successful lookup. Manual token entry is a fallback, rate-limited.
- **TIME**: store UTC, display Asia/Colombo (UTC+5:30). `issued_at` may be backdated; ledger
  stays append-only and sequential by insertion order.
- **DRIVERS**: optional, fully modeled (nullable `driver_id` FK). Driver reports exist but hidden
  until enabled — no migration to turn on.
- **OUT OF SCOPE v1**: cost/currency (keep `unit_cost` column, hide in UI), offline, GPS, SSO
  (keep code SSO-ready).

## Roles & authorization

OPERATOR, SUPERVISOR, MANAGER, ADMIN — enforce via tRPC middleware on EVERY protected
procedure (never trust the client). Data scoping: operator=own tank, supervisor=own site,
manager/admin=all. Override authority: ADMIN only. Adjustments: SUPERVISOR or ADMIN.

## SECURITY BY DESIGN (apply in every phase; verified in Phase 7)

- **Authentication**: Auth.js Credentials with argon2id (preferred) or bcrypt cost>=12. Enforce a
  strong password policy. Generic login errors (no user-enumeration). Session = httpOnly,
  Secure, SameSite=strict cookies; short-lived with rotation. Lockout/backoff after repeated
  failed logins.
- **Authorization**: server-side role + ownership checks on every mutation and query. No
  privilege escalation via IDs — always verify the actor may act on the target resource.
- **Input validation**: shared Zod schemas validate ALL input on the server (client validation is
  UX only). Reject unknown fields. Validate numeric ranges (liters>0, meter reading sane).
- **Injection safety**: only parameterized Prisma queries; no raw string SQL. Escape/encode all
  output; React auto-escaping preserved (no `dangerouslySetInnerHTML` with user data).
- **CSRF**: tRPC mutations protected; Auth.js CSRF enabled. Set security headers via middleware:
  Content-Security-Policy, X-Frame-Options=DENY, X-Content-Type-Options=nosniff,
  Referrer-Policy, Strict-Transport-Security (for HTTPS), Permissions-Policy.
- **Rate limiting**: on login, manual QR token entry, and fuel submission endpoints.
- **Secrets**: only via environment variables; never commit secrets; provide `.env.example` with
  placeholders; NEXTAUTH_SECRET generated per environment.
- **Audit trail**: append-only `audit_log` capturing actor, action, entity, before/after where
  relevant, timestamp, IP. Cover logins, overrides, adjustments, role/tank assignment changes.
- **Least privilege**: DB user for the app has only needed grants. Document this in deploy notes.
- **Dependencies**: pin versions; note running `npm audit` in CI; avoid unmaintained packages.
- **Error handling**: never leak stack traces or internal detail to clients; log server-side via
  Pino with correlation IDs; return safe, generic messages.
- **PII**: minimal collection; do not put sensitive data in URLs/query strings or logs.

## DESIGN SYSTEM — match docs/fuel-ui-prototype.html exactly

Port tokens into `tailwind.config.ts` and a shadcn/ui theme. Font: Inter (400–800) via next/font.

Colors: bg `#F6F7F9`, card `#FFFFFF`, sidebar `#0F172A`, text `#0F172A`, muted `#475569`,
primary `#0F766E`, petrol `#15803D`, diesel `#D97706`, kerosene `#2563EB`, danger `#DC2626`,
warning `#F59E0B`, info `#2563EB`, success `#16A34A`, border `#E2E8F0`.

Radii: cards 20–32px (token `xl2`=20px + larger). Shadows: soft `0 10px 30px rgba(15,23,42,.08)`,
panel `0 4px 18px rgba(15,23,42,.06)`.

Patterns: rounded-full fuel-type chips (petrol green / diesel amber / kerosene blue); dark slate (`#0F172A`)
context cards for "assigned tank"; mobile = one primary action per 390-wide screen; desktop =
248px dark sidebar + light content (1440-based); KPI card grids; large bold numbers.

Reusable components (atoms/molecules/organisms) matching the prototype: Button (Primary/
Secondary), Input, Badge/FuelType, StatusIcon, Avatar, KpiCard, VehicleLookupCard,
AuditEventRow, TankContextHeader, MeterBlockedBanner, QRScannerModal, plus the screens.

Prototype screens to reproduce: M1 Login, M2 Operator Home, M3 QR Scanner, M4 Vehicle
Recognized, M5 Fuel Issue Form, M6 Meter Blocked (drawn as "Odometer Blocked" in the prototype —
same screen, meter-type-aware labels), M7 Fuel Type Mismatch, D1 Admin Dashboard, D3 Tank
Detail, D6 Meter Exception Review, and the admin shell nav (Dashboard, Fuel Issues,
Deliveries, Adjustments, Vehicles, Tanks, Users, QR Tokens, Audit, Settings). Screens implied
but not drawn (design in the SAME language): success receipt, delivery entry, adjustment flag,
list views, CRUD forms, Users + tank assignment, QR token generate/print/rotate, audit trail,
settings (per-vehicle-type meter type + efficiency bounds), per-vehicle efficiency report with
drill-down.

## Code quality

Always output COMPLETE files with full paths. Consistent naming across DB/API/UI. Explicit
error handling. JSDoc on services. Pino structured logs. Tests for services and critical flows.

## Working method

Before each phase: restate scope, the exact file list, and acceptance criteria (including the
security acceptance items relevant to that phase). Then generate every file in full. Work only
on the phase named. After each phase, stop and give exact verification steps, then wait.

Phase plan:

- **0** Foundation + design tokens + security baseline ✅ (complete)
- **1** Schema + auth (hardened) + seed
- **2** Design-system components + master data + QR tokens
- **3** Fuel entry core (atomic ledger, idempotency, hard-blocks)
- **4** Deliveries + adjustments + reconciliation
- **5** Dashboards + KPIs + alerts
- **6** Reports + export + drill-downs
- **7** Security hardening + audit review + tests + Windows Server deployment
