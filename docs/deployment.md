# Deployment — On-Premise Windows Server

> Audience: the engineer installing and operating the Fuel Usage & Stock
> Tracking System on an internal Windows Server. This is the technical runbook.
> End-user instructions live in [guides/](guides/).

The application is an internal, on-premise Next.js 14 service backed by
PostgreSQL 16. It is designed for a private LAN — **not** the public internet.
Everything below assumes a single Windows Server host (physical or VM) reachable
by operators' phones/tablets and admin desktops on the same network.

---

## 1. Target topology

```text
              ┌──────────────────────────── Windows Server ───────────────────────────┐
 Operators →  │  Reverse proxy (HTTPS)  →  Next.js app (Windows Service, :3000, local) │
 Admins    →  │        :443                        │                                   │
              │                                     └→  PostgreSQL 16 (local, :5432)    │
              └───────────────────────────────────────────────────────────────────────┘
```

- The Next.js server binds to **127.0.0.1:3000** and is never exposed directly.
- A reverse proxy terminates **HTTPS on :443** and forwards to the app. HTTPS is
  required so the camera-based QR scanner works on operators' devices (browsers
  only grant camera access over `https://` or `localhost`).
- PostgreSQL listens on **localhost only**; nothing outside the host connects to it.

Two supported variants:

- **Native (recommended for a single host):** PostgreSQL Windows installer + the
  app as a Windows Service (via NSSM), fronted by **Caddy** (simplest internal
  HTTPS) or **IIS with the Application Request Routing (ARR) + URL Rewrite**
  modules. This runbook uses Caddy as the primary example and notes IIS deltas.
- **Docker:** app + database as containers on Docker for Windows Server. Only
  choose this if the org already standardises on containers; the native path has
  fewer moving parts on Windows.

---

## 2. Prerequisites

| Component     | Version                | Notes                                                    |
| ------------- | ---------------------- | -------------------------------------------------------- |
| Windows Server| 2019 / 2022            | Domain-joined or workgroup, on the internal network      |
| Node.js       | 20 LTS or newer        | Install the MSI for "all users"; verify `node --version` |
| PostgreSQL    | 16.x                   | Native Windows installer from EnterpriseDB               |
| NSSM          | 2.24+                  | Runs the app as a Windows Service                        |
| Caddy         | 2.x (or IIS + ARR)     | HTTPS reverse proxy                                      |
| Git           | latest                 | To pull the source (or copy a build artifact)            |

Open **PowerShell as Administrator** for the service, firewall, and TLS steps.

---

## 3. Application database user (least privilege)

Do **not** run the app as the `postgres` superuser. Create a dedicated login
that owns the application schema but has no server-admin rights.

```powershell
# Run as the postgres superuser (psql). Replace the password with a strong,
# per-environment secret kept only in the app's .env — never commit it.
psql -U postgres -h 127.0.0.1 -c "CREATE ROLE fuel_app LOGIN PASSWORD 'REPLACE_WITH_STRONG_SECRET';"
psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE fuel_tracking OWNER fuel_app;"
```

Migrations are applied with this same `fuel_app` role during release (it owns the
schema, so it can run DDL at deploy time). At **runtime** the app performs only
DML (SELECT/INSERT/UPDATE) — the ledger is append-only and never issues DDL.

### Split privileges (recommended for hardened deployments)

If your policy requires it, run **migrations** as the schema owner (`fuel_app`)
and run the **service** as a second role that can only read and write rows — no
DDL, no ability to alter or drop the ledger. The app never needs `DELETE`
(the ledger and audit trail are append-only) so it is not granted, which turns
an app-level compromise into an inability to erase history.

```sql
-- As the postgres superuser, after migrations have created the schema.
CREATE ROLE fuel_runtime LOGIN PASSWORD 'REPLACE_WITH_STRONG_SECRET';

-- Connect + read the schema, but never modify its shape.
GRANT CONNECT ON DATABASE fuel_tracking TO fuel_runtime;
GRANT USAGE  ON SCHEMA public           TO fuel_runtime;

-- Row-level DML only. Deliberately NO DELETE, NO TRUNCATE, NO DDL.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES    IN SCHEMA public TO fuel_runtime;
GRANT USAGE, SELECT          ON ALL SEQUENCES  IN SCHEMA public TO fuel_runtime;

-- Apply the same grants to tables/sequences created by FUTURE migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE fuel_app IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES    TO fuel_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE fuel_app IN SCHEMA public
  GRANT USAGE, SELECT          ON SEQUENCES TO fuel_runtime;
```

Then point the two contexts at their own roles:

- **Migrations** (release step, section 5): `DATABASE_URL` uses `fuel_app`.
- **Running service** (section 6): `DATABASE_URL` uses `fuel_runtime`.

Record both connection strings in your change log; both stay in environment
variables and are never committed. Re-run the two `ALTER DEFAULT PRIVILEGES`
grants once after each release that adds tables (or make them part of your
post-migrate step) so `fuel_runtime` can see new tables.

Add `fuel_runtime` to `pg_hba.conf` alongside `fuel_app` with the same
`scram-sha-256`, localhost-only rules.

Harden `pg_hba.conf` (in the PostgreSQL `data` directory) so only local
connections are accepted, using `scram-sha-256`:

```text
# TYPE  DATABASE        USER       ADDRESS         METHOD
host    fuel_tracking   fuel_app   127.0.0.1/32    scram-sha-256
host    fuel_tracking   fuel_app   ::1/128         scram-sha-256
```

Reload PostgreSQL after editing (`Restart-Service postgresql-x64-16`).

---

## 4. Environment configuration

Copy `.env.example` to `.env` in the app directory and fill in production values.
**Never commit `.env`.** Generate a unique secret per environment:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Minimum production `.env`:

```ini
# App
NODE_ENV=production
# Must be the HTTPS URL operators actually browse to (drives Secure cookies + camera).
NEXTAUTH_URL=https://fuel.internal.example
# Per-environment secret from the command above. Rotating it invalidates sessions.
NEXTAUTH_SECRET=<generated-base64-secret>

# Database — the least-privilege app role, localhost only.
DATABASE_URL=postgresql://fuel_app:REPLACE_WITH_STRONG_SECRET@127.0.0.1:5432/fuel_tracking?schema=public

# Logging
LOG_LEVEL=info
```

`src/lib/env.ts` fails fast at boot if a required variable is missing, reporting
variable **names** only (never values). Confirm the process user can read `.env`
and that its NTFS ACL excludes everyone but the service account and admins.

---

## 5. Build the application

From the app directory, as the deploying user:

```powershell
npm ci                     # clean, lockfile-exact install (runs prisma generate)
npx prisma migrate deploy  # apply committed migrations (no dev prompts)
npm run build              # Next.js production build
```

Optionally seed baseline reference data. The bundled `prisma/seed.ts` creates
**development** accounts with known passwords — do **not** run it as-is in
production. For a real deployment, either:

- create the first ADMIN account through a one-off script that reads a password
  from an environment variable and hashes it with the app's argon2id helper, or
- run the seed once in a staging copy, then have that ADMIN create real users and
  **immediately** delete/disable the seeded demo accounts.

Every account the ADMIN creates gets a temporary password and is forced to set
its own at first sign-in (see the guides).

---

## 6. Run the app as a Windows Service (NSSM)

Running `npm run start` in a console is fine for a smoke test but won't survive
logoff or reboot. Register it as a service:

```powershell
# Install (adjust paths). node.exe runs Next's standalone start via npm.
nssm install FuelTracking "C:\Program Files\nodejs\node.exe"
nssm set FuelTracking AppParameters "node_modules\next\dist\bin\next start -p 3000 -H 127.0.0.1"
nssm set FuelTracking AppDirectory "C:\apps\fuel-tracking-system"
nssm set FuelTracking AppEnvironmentExtra "NODE_ENV=production"
nssm set FuelTracking Start SERVICE_AUTO_START

# Log rotation for Pino's stdout/stderr JSON.
nssm set FuelTracking AppStdout "C:\apps\fuel-tracking-system\logs\app.out.log"
nssm set FuelTracking AppStderr "C:\apps\fuel-tracking-system\logs\app.err.log"
nssm set FuelTracking AppRotateFiles 1
nssm set FuelTracking AppRotateBytes 10485760

nssm start FuelTracking
```

Run the service under a **dedicated low-privilege service account** (not
LocalSystem) that can read the app directory and `.env` and nothing else. Confirm
`Get-Service FuelTracking` reports `Running` and that
`curl.exe http://127.0.0.1:3000/login` returns HTML.

Health endpoint: the app exposes a tRPC `health` procedure; a simple external
check is an HTTP GET of `/login` (200 = up).

---

## 7. HTTPS reverse proxy

### Option A — Caddy (simplest internal HTTPS)

`Caddyfile`:

```text
fuel.internal.example {
    encode gzip
    reverse_proxy 127.0.0.1:3000
    # tls internal   # uncomment to use Caddy's internal CA on a closed network
}
```

On a closed LAN with no public DNS, either use `tls internal` (and distribute
Caddy's root cert to devices via GPO) or supply an internal-CA certificate with
`tls cert.pem key.pem`. Operators' devices must trust the issuing CA or the
camera page will warn.

Run Caddy as a service (NSSM the same way) so it starts on boot.

### Option B — IIS + ARR

1. Install **URL Rewrite** and **Application Request Routing** modules.
2. Create an HTTPS site bound to the internal certificate on :443.
3. Enable ARR proxy and add a reverse-proxy rule forwarding to
   `http://127.0.0.1:3000/`.
4. Preserve the `Host`, `X-Forwarded-Proto=https`, and `X-Forwarded-For` headers.

Either way, the proxy must forward `X-Forwarded-Proto: https` so the app emits
`Strict-Transport-Security` and marks cookies `Secure`.

### Security headers

The app already sets CSP, `X-Frame-Options=DENY`, `X-Content-Type-Options=nosniff`,
`Referrer-Policy`, `Permissions-Policy`, and (in production/HTTPS) HSTS via
`src/middleware.ts`. Do not strip these at the proxy. Verify after go-live:

```powershell
curl.exe -sI https://fuel.internal.example/login | Select-String "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy"
```

---

## 8. Firewall

```powershell
# Allow HTTPS from the LAN to the proxy only.
New-NetFirewallRule -DisplayName "Fuel Tracking HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Domain,Private

# The app (3000) and PostgreSQL (5432) stay LOCAL — do NOT open them.
```

Confirm 3000 and 5432 are not reachable from another host on the network.

---

## 9. Backups & restore (PostgreSQL)

The stock ledger is the system of record — back it up on a schedule and test
restores.

```powershell
# Nightly logical backup (custom format). Schedule via Task Scheduler.
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U fuel_app -h 127.0.0.1 -F c -f "D:\backups\fuel_tracking-$stamp.dump" fuel_tracking
```

Restore into a fresh database (verify on a staging box, never test-restore over
production):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d fuel_tracking_restore --clean --if-exists "D:\backups\fuel_tracking-YYYYMMDD-HHMM.dump"
```

Keep backups on a separate volume with restricted ACLs; retain per your policy.
Because the ledger is append-only, point-in-time consistency matters more than
frequency — a nightly dump plus WAL archiving (optional) is sufficient for most
internal deployments.

---

## 10. Scheduled reconciliation

The ledger's cached `tank.current_stock` must always equal the latest movement's
`balance_after`. Schedule the reconciliation check and alert on a non-zero exit:

```powershell
# Task Scheduler action, daily. Working dir = app directory.
npm run reconcile        # exit code 1 on ANY mismatch
```

- **Cache mismatch** (chain intact) is safely repairable: `npm run reconcile -- --repair`
  (audited as `TANK_UPDATED`). Consider a manual review before auto-repairing.
- **Chain broken** is **never** auto-repaired — it means ledger rows themselves
  are inconsistent and must be investigated. Treat a chain-broken result as an
  incident.

Wire the task to notify (email/log alert) when the exit code is 1.

---

## 10a. Audit-trail retention (archive-and-prune)

The audit trail is append-only and grows forever. Rows are **preserved, never
deleted**: `npm run archive-audit` writes rows older than the retention window
to a gzipped JSON Lines archive, reads the file back to prove it holds exactly
those rows, and only then removes those exact ids. Any failure aborts with
**zero rows removed**.

There is deliberately **no in-app control** that deletes audit rows. Removal
exists solely as the verified tail of this CLI run.

```bash
# Linux server (fuel.local) — nightly cron, e.g. 02:30. Working dir = app directory.
npm run archive-audit                                  # keep 12 months hot (default)
npm run archive-audit -- --retain-months=24            # keep 24 months hot
npm run archive-audit -- --archive-dir=/root/backups/audit
npm run archive-audit -- --actor=admin                 # attribute the event to a user
npm run archive-audit -- --dry-run                     # report only; writes/deletes nothing
```

Example crontab entry, alongside the existing version snapshots and DB backups:

```cron
30 2 * * *  cd /opt/fuel-tracking-system && /usr/bin/npm run archive-audit >> /var/log/fuel-archive-audit.log 2>&1
```

- **Archive directory** defaults to `./backups/audit` (relative to the app
  directory). Override per-run with `--archive-dir=` or globally with the
  `AUDIT_ARCHIVE_DIR` environment variable. Keep it on the same protected volume
  as the database backups (`/root/backups`), with restricted permissions — the
  archives contain the full compliance record.
- **Retention** defaults to 12 months, overridable with `--retain-months=` or
  `AUDIT_RETENTION_MONTHS`.
- **Exit code 1** means verification failed and **nothing was deleted**. The
  trail is intact; investigate the archive path named in the output before
  retrying. Wire the job to alert on exit code 1.
- Each run archives up to one batch (5,000 rows). Run it again to continue if a
  backlog is larger than one batch; the nightly schedule drains it over time.
- Every completed run records an `AUDIT_ARCHIVED` event — window, row count,
  archive filename, and SHA-256 — into the *remaining* trail, so the archival is
  itself accountable. Archives are restored by decompressing the `.jsonl.gz` and
  reading one JSON document per line.

**On-demand export.** Managers and admins (anyone with `audit.view`) can export
a date range of the trail to CSV/XLSX from the Audit page or the Reports page.
That path is strictly read-only and is itself recorded as `AUDIT_EXPORTED`.

---

## 11. Upgrades / redeploy

```powershell
nssm stop FuelTracking
git pull                    # or drop in the new build artifact
npm ci
npx prisma migrate deploy   # forward-only migrations
npm run build
nssm start FuelTracking
```

Take a database backup **before** `migrate deploy`. Migrations are forward-only;
roll back by restoring the pre-upgrade backup and the previous build.

---

## 12. Post-deploy verification checklist

- [ ] `https://fuel.internal.example/login` loads over HTTPS with a trusted cert.
- [ ] Security headers present (section 7).
- [ ] Admin can sign in; seeded demo accounts removed/disabled.
- [ ] A newly created user is forced to change password at first sign-in.
- [ ] Operator on a phone can open the scanner and the **camera starts** (HTTPS).
- [ ] Manual token entry works as a fallback.
- [ ] A fuel issue records and appears on the dashboard and in reports.
- [ ] CSV and XLSX exports download and match the on-screen figures.
- [ ] `npm run reconcile` exits 0.
- [ ] Nightly backup task and daily reconcile task are scheduled and enabled.
- [ ] `npm run archive-audit -- --dry-run` exits 0 and names a writable archive
      directory; the nightly archive job is scheduled and alerts on exit code 1.
- [ ] PostgreSQL and app ports are not reachable from other hosts.
- [ ] Audit trail shows the go-live logins.

See [security.md](security.md) for the security controls verified in Phase 7 and
the residual-risk register.
