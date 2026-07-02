# check-project.ps1 — run from the project root AFTER Phase 0
$ErrorActionPreference = "SilentlyContinue"

Write-Host "`n=== Fuel Tracker : project scaffold check ===`n" -ForegroundColor Cyan

if (-not (Test-Path ".\package.json")) {
    Write-Host "[STOP] No package.json here. Run this from the project root after Phase 0." -ForegroundColor Red
    return
}

# Expected npm packages (installed by Phase 0)
$pkg = Get-Content ".\package.json" -Raw | ConvertFrom-Json
$deps = @{}
if ($pkg.dependencies)    { $pkg.dependencies.PSObject.Properties    | ForEach-Object { $deps[$_.Name] = $_.Value } }
if ($pkg.devDependencies) { $pkg.devDependencies.PSObject.Properties | ForEach-Object { $deps[$_.Name] = $_.Value } }

$expect = @(
    "next","react","typescript","@prisma/client","prisma","@trpc/server",
    "@trpc/client","next-auth","zod","tailwindcss","pino"
)
Write-Host "-- Key packages in package.json --" -ForegroundColor Cyan
foreach ($e in $expect) {
    if ($deps.ContainsKey($e)) {
        Write-Host ("[OK]      {0,-22} {1}" -f $e, $deps[$e]) -ForegroundColor Green
    } else {
        Write-Host ("[MISSING] {0,-22} not in package.json" -f $e) -ForegroundColor Red
    }
}

# node_modules actually installed?
Write-Host "`n-- Installation state --" -ForegroundColor Cyan
if (Test-Path ".\node_modules") { Write-Host "[OK]      node_modules present" -ForegroundColor Green }
else { Write-Host "[MISSING] node_modules -> run 'npm install'" -ForegroundColor Red }

# Expected config files & folders
Write-Host "`n-- Config files & structure --" -ForegroundColor Cyan
$paths = @(
    "tsconfig.json","tailwind.config.ts","next.config.js","next.config.mjs",
    "docker-compose.yml",".env.example","CLAUDE.md",
    "prisma\schema.prisma","src\app","src\server\api","src\server\services",
    "src\server\db","src\lib","src\components"
)
foreach ($p in $paths) {
    if (Test-Path ".\$p") { Write-Host ("[OK]      {0}" -f $p) -ForegroundColor Green }
    else { Write-Host ("[--]      {0}  (may be fine if named differently)" -f $p) -ForegroundColor Yellow }
}

# Env file present but not committed?
Write-Host "`n-- Secrets hygiene --" -ForegroundColor Cyan
if (Test-Path ".\.env") {
    $gi = Get-Content ".\.gitignore" -Raw -ErrorAction SilentlyContinue
    if ($gi -match "\.env") { Write-Host "[OK]      .env exists and is gitignored" -ForegroundColor Green }
    else { Write-Host "[WARN]    .env exists but NOT in .gitignore -> add it now" -ForegroundColor Red }
} else {
    Write-Host "[--]      no .env yet (copy from .env.example before running the app)" -ForegroundColor Yellow
}

# Try the quick quality gates
Write-Host "`n-- Build / lint / test (this may take a minute) --" -ForegroundColor Cyan
Write-Host "Running npm run lint ..." -ForegroundColor DarkGray
npm run lint 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "[OK]      lint passed" -ForegroundColor Green }
else { Write-Host "[WARN]    lint reported issues -> run 'npm run lint' to see them" -ForegroundColor Yellow }

Write-Host "Running npm run test ..." -ForegroundColor DarkGray
npm run test 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "[OK]      tests passed" -ForegroundColor Green }
else { Write-Host "[WARN]    tests failed or no test script -> check 'npm run test'" -ForegroundColor Yellow }

Write-Host "`n-- Dependency vulnerabilities --" -ForegroundColor Cyan
npm audit 2>&1 | Select-String "vulnerabilit" | Select-Object -First 2 | ForEach-Object { Write-Host $_ }

Write-Host "`nDone. RED = fix before proceeding. YELLOW = check but often fine.`n" -ForegroundColor Cyan