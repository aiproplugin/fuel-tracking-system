# Fuel Usage & Stock Tracking System

Internal operations portal for issued fuel, deliveries, stock, and audit control.
On-premise deployment on Windows Server; development on Windows 10.

**Stack:** Next.js 14 (App Router) · TypeScript (strict) · tRPC · Prisma · PostgreSQL 16 ·
Auth.js v5 (Credentials + argon2id) · Zod · Tailwind CSS · Pino · Vitest

Standing project rules live in [CLAUDE.md](CLAUDE.md). Architecture and security
notes live in [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).
The visual spec is [docs/fuel-ui-prototype.html](docs/fuel-ui-prototype.html).

---

## Development setup (Windows 10)

### Prerequisites

- **Node.js 20 LTS or newer** — <https://nodejs.org> (`node --version`)
- **Docker Desktop** (for the local PostgreSQL 16 container) — <https://www.docker.com/products/docker-desktop/>
- **Git** — <https://git-scm.com>

All commands below run in **PowerShell** from the project root.

### 1. Install dependencies

```powershell
npm install
```

This also runs `prisma generate` (postinstall).

### 2. Create your environment file

```powershell
Copy-Item .env.example .env
```

Then generate a session secret and paste it into `.env` as `NEXTAUTH_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The default `DATABASE_URL` in `.env.example` matches the docker-compose dev
database — no change needed for local work. **Never commit `.env`.**

### 3. Start PostgreSQL 16

```powershell
docker compose up -d
```

Verify it is healthy:

```powershell
docker compose ps
```

### 4. Create the database schema and seed data

```powershell
npm run db:migrate   # applies Prisma migrations (prisma migrate dev)
npm run db:seed      # sites, tanks (ledger-backed stock), users, vehicles, QR tokens
```

### 5. Run the app

```powershell
npm run dev
```

Open <http://localhost:3000> and sign in with a seeded account.

#### Seeded development accounts (DEV ONLY — never reuse in production)

| Username     | Password              | Role       | Scope                       |
| ------------ | --------------------- | ---------- | --------------------------- |
| `admin`      | `Admin#Fuel2026`      | ADMIN      | Everything                  |
| `manager`    | `Manager#Fuel2026`    | MANAGER    | All sites (read/report)     |
| `supervisor` | `Supervisor#Fuel2026` | SUPERVISOR | Main Depot                  |
| `operator1`  | `Operator1#Fuel2026`  | OPERATOR   | Tank A (Diesel), Main Depot |
| `operator2`  | `Operator2#Fuel2026`  | OPERATOR   | Tank B (Petrol), Main Depot |

Accounts created or password-reset through the admin Users page receive a
TEMPORARY password: the user is forced to set their own at first sign-in
(the seeded accounts above are exempt).

Five consecutive wrong passwords lock an account for 15 minutes (exponential
backoff after that). To unlock immediately in dev:

```powershell
docker exec fuel-tracking-postgres psql -U fuel_app -d fuel_tracking -c "UPDATE app_user SET failed_login_count = 0, locked_until = NULL WHERE username = 'operator1';"
```

### Swapping the logo

The brand mark is read from **`public/logo.png`** by exactly one component —
[src/components/brand/logo.tsx](src/components/brand/logo.tsx) — which every
screen (login, /home, admin sidebar, QR print sheets) renders through. To
rebrand:

1. Replace `public/logo.png` with the new file (keep the same name; any
   near-square image works — it is letterboxed with `object-contain`, never
   distorted). 650×650 or larger is recommended so it stays crisp at high DPI.
2. Restart the dev server (or rebuild for production) and hard-refresh the
   browser (Ctrl+F5) to drop the old cached image.

No code changes are needed anywhere.

### 6. Tests, lint, types

```powershell
npm run test        # Vitest
npm run lint        # ESLint (zero errors expected)
npm run typecheck   # tsc --noEmit (zero errors expected)
```

### Verifying the security headers

With the dev server running:

```powershell
curl.exe -sI http://localhost:3000/login | Select-String "content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy"
```

Or in the browser: DevTools → Network → select the `login` document request →
Response Headers. `Strict-Transport-Security` appears only in production builds.

---

## Production on Windows Server (placeholder — detailed in Phase 7)

Phase 7 documents and scripts the full deployment, comparing:

- **Native:** PostgreSQL 16 Windows installer + the Next.js server as a Windows
  Service (NSSM or node-windows), fronted by IIS (ARR) or Caddy for HTTPS
  termination on the internal network.
- **Docker:** app + database containers on Docker for Windows Server.

Both variants will include: a least-privilege application DB user (no DDL at
runtime), per-environment `NEXTAUTH_SECRET`, HTTPS-only cookies, log rotation
for Pino JSON logs, and backup/restore procedures for PostgreSQL.
