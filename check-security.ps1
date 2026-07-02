# check-security.ps1 — run AFTER Phase 0, with the dev server running (npm run dev)
# Verifies Phase 0 security acceptance criteria: headers + DB connectivity.
$ErrorActionPreference = "SilentlyContinue"
$base = "http://localhost:3000"

Write-Host "`n=== Fuel Tracker : security + connectivity check ===`n" -ForegroundColor Cyan

# 1. Is the dev server up?
$resp = try { Invoke-WebRequest -Uri $base -UseBasicParsing -TimeoutSec 8 } catch { $_.Exception.Response }
if (-not $resp) {
    Write-Host "[STOP] No response from $base — start the dev server first: npm run dev" -ForegroundColor Red
    return
}
Write-Host "[OK]      Dev server responding at $base" -ForegroundColor Green

# 2. Security headers
Write-Host "`n-- Security headers --" -ForegroundColor Cyan
$headers = $resp.Headers
$want = @(
    @("Content-Security-Policy",   "Restricts what can load — blocks injection/XSS"),
    @("X-Frame-Options",           "Should be DENY — blocks clickjacking"),
    @("X-Content-Type-Options",    "Should be nosniff — blocks MIME sniffing"),
    @("Referrer-Policy",           "Controls referrer leakage"),
    @("Permissions-Policy",        "Restricts browser features"),
    @("Strict-Transport-Security", "HTTPS-only (may be absent on http dev — OK)")
)
foreach ($h in $want) {
    $val = $headers[$h[0]]
    if ($val) {
        Write-Host ("[OK]      {0,-28} {1}" -f $h[0], ([string]$val).Substring(0,[Math]::Min(48,([string]$val).Length))) -ForegroundColor Green
    } else {
        $color = if ($h[0] -eq "Strict-Transport-Security") { "Yellow" } else { "Red" }
        Write-Host ("[MISSING] {0,-28} {1}" -f $h[0], $h[1]) -ForegroundColor $color
    }
}

# 3. Server header should not leak stack details
Write-Host "`n-- Information leakage --" -ForegroundColor Cyan
$srv = $headers["Server"]
$xpb = $headers["X-Powered-By"]
if ($xpb) { Write-Host "[WARN]    X-Powered-By present ($xpb) — consider removing to reduce fingerprinting" -ForegroundColor Yellow }
else { Write-Host "[OK]      X-Powered-By not exposed" -ForegroundColor Green }

# 4. Session cookie flags (hit the login/auth route)
Write-Host "`n-- Session cookie flags --" -ForegroundColor Cyan
$authResp = try { Invoke-WebRequest -Uri "$base/api/auth/session" -UseBasicParsing -TimeoutSec 8 } catch { $_.Exception.Response }
$setCookie = $null
if ($authResp -and $authResp.Headers) { $setCookie = $authResp.Headers["Set-Cookie"] }
if ($setCookie) {
    if ($setCookie -match "HttpOnly")  { Write-Host "[OK]      HttpOnly flag set" -ForegroundColor Green } else { Write-Host "[WARN] HttpOnly not seen on cookie" -ForegroundColor Yellow }
    if ($setCookie -match "SameSite")  { Write-Host "[OK]      SameSite flag set" -ForegroundColor Green } else { Write-Host "[WARN] SameSite not seen" -ForegroundColor Yellow }
    if ($setCookie -match "Secure")    { Write-Host "[OK]      Secure flag set" -ForegroundColor Green } else { Write-Host "[--]   Secure absent (expected on http dev; must be set in prod HTTPS)" -ForegroundColor Yellow }
} else {
    Write-Host "[--]      No Set-Cookie yet (only issued after login) — re-check post-login" -ForegroundColor Yellow
}

# 5. Postgres connection (via docker compose)
Write-Host "`n-- Database connectivity --" -ForegroundColor Cyan
$pgReady = docker compose exec -T db pg_isready 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK]      PostgreSQL accepting connections" -ForegroundColor Green
} else {
    $running = docker ps --format "{{.Names}}" 2>&1 | Select-String -Pattern "db|postgres"
    if ($running) { Write-Host "[WARN]    Postgres container up but pg_isready failed — check service name in docker-compose.yml" -ForegroundColor Yellow }
    else { Write-Host "[MISSING] Postgres not running — run: docker compose up -d" -ForegroundColor Red }
}

Write-Host "`nNote: on http://localhost the Secure cookie flag and HSTS are expected to be absent." -ForegroundColor DarkGray
Write-Host "They MUST be present in the Phase 7 HTTPS production check.`n" -ForegroundColor DarkGray