# check-security.ps1  (ASCII-only, auto-detects port 3000 or 3001)
# Run AFTER Phase 0 with the dev server running (npm run dev).
# Verifies security headers, cookie flags, and Postgres connectivity.

$ErrorActionPreference = "SilentlyContinue"

# --- Find the running dev server on 3000 or 3001 ---
$base = $null
foreach ($port in 3000, 3001) {
    $probe = try { Invoke-WebRequest -Uri "http://localhost:$port" -UseBasicParsing -TimeoutSec 5 } catch { $_.Exception.Response }
    if ($probe) { $base = "http://localhost:$port"; break }
}

Write-Host ""
Write-Host "=== Fuel Tracker : security + connectivity check ===" -ForegroundColor Cyan
Write-Host ""

if (-not $base) {
    Write-Host "[STOP] No dev server found on port 3000 or 3001. Start it first: npm run dev" -ForegroundColor Red
    return
}
Write-Host "[OK]      Dev server responding at $base" -ForegroundColor Green

# --- Fetch headers from the login page ---
$resp = try { Invoke-WebRequest -Uri "$base/login" -UseBasicParsing -TimeoutSec 8 } catch { $_.Exception.Response }
if (-not $resp) {
    Write-Host "[STOP] Server is up but /login did not respond." -ForegroundColor Red
    return
}
$headers = $resp.Headers

# --- Security headers ---
Write-Host ""
Write-Host "-- Security headers --" -ForegroundColor Cyan
$want = @(
    @("Content-Security-Policy",   "Restricts what can load - blocks injection/XSS"),
    @("X-Frame-Options",           "Should be DENY - blocks clickjacking"),
    @("X-Content-Type-Options",    "Should be nosniff - blocks MIME sniffing"),
    @("Referrer-Policy",           "Controls referrer leakage"),
    @("Permissions-Policy",        "Restricts browser features"),
    @("Strict-Transport-Security", "HTTPS-only (absent on http dev is OK)")
)
foreach ($h in $want) {
    $name = $h[0]
    $why  = $h[1]
    $val  = $headers[$name]
    if ($val) {
        $shown = [string]$val
        if ($shown.Length -gt 48) { $shown = $shown.Substring(0, 48) }
        Write-Host ("[OK]      {0,-28} {1}" -f $name, $shown) -ForegroundColor Green
    }
    else {
        if ($name -eq "Strict-Transport-Security") {
            Write-Host ("[--]      {0,-28} {1}" -f $name, $why) -ForegroundColor Yellow
        }
        else {
            Write-Host ("[MISSING] {0,-28} {1}" -f $name, $why) -ForegroundColor Red
        }
    }
}

# --- Information leakage ---
Write-Host ""
Write-Host "-- Information leakage --" -ForegroundColor Cyan
$xpb = $headers["X-Powered-By"]
if ($xpb) {
    Write-Host ("[WARN]    X-Powered-By present ({0}) - consider removing" -f $xpb) -ForegroundColor Yellow
}
else {
    Write-Host "[OK]      X-Powered-By not exposed" -ForegroundColor Green
}

# --- Session cookie flags ---
Write-Host ""
Write-Host "-- Session cookie flags --" -ForegroundColor Cyan
$authResp = try { Invoke-WebRequest -Uri "$base/api/auth/session" -UseBasicParsing -TimeoutSec 8 } catch { $_.Exception.Response }
$setCookie = $null
if ($authResp -and $authResp.Headers) { $setCookie = $authResp.Headers["Set-Cookie"] }
if ($setCookie) {
    if ($setCookie -match "HttpOnly") { Write-Host "[OK]      HttpOnly flag set" -ForegroundColor Green } else { Write-Host "[WARN]    HttpOnly not seen" -ForegroundColor Yellow }
    if ($setCookie -match "SameSite") { Write-Host "[OK]      SameSite flag set" -ForegroundColor Green } else { Write-Host "[WARN]    SameSite not seen" -ForegroundColor Yellow }
    if ($setCookie -match "Secure")   { Write-Host "[OK]      Secure flag set" -ForegroundColor Green } else { Write-Host "[--]      Secure absent (expected on http dev; required in prod HTTPS)" -ForegroundColor Yellow }
}
else {
    Write-Host "[--]      No Set-Cookie yet (only issued after login) - re-check post-login" -ForegroundColor Yellow
}

# --- Database connectivity ---
Write-Host ""
Write-Host "-- Database connectivity --" -ForegroundColor Cyan
$pgReady = docker compose exec -T db pg_isready 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK]      PostgreSQL accepting connections" -ForegroundColor Green
}
else {
    $running = docker ps --format "{{.Names}}" 2>&1 | Select-String -Pattern "postgres"
    if ($running) {
        Write-Host "[WARN]    Postgres container up but pg_isready failed - check the service name in docker-compose.yml (expected 'db')" -ForegroundColor Yellow
    }
    else {
        Write-Host "[MISSING] Postgres not running - run: docker compose up -d" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Note: on http://localhost the Secure cookie flag and HSTS are expected to be absent." -ForegroundColor DarkGray
Write-Host "They MUST be present in the Phase 7 HTTPS production check." -ForegroundColor DarkGray
Write-Host ""
