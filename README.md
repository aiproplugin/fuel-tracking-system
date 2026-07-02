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

### 4. Run the app

```powershell
npm run dev
```

Open <http://localhost:3000> — you are redirected to the login screen
(authentication activates in Phase 1).

### 5. Tests, lint, types

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
