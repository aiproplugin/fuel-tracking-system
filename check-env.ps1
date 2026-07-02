# check-env.ps1 — Fuel Tracker prerequisite checker (run BEFORE Phase 0)
$ErrorActionPreference = "SilentlyContinue"

function Test-Tool($name, $cmd, $versionArg, $minMajor, $why) {
    $path = (Get-Command $cmd -ErrorAction SilentlyContinue).Source
    if (-not $path) {
        Write-Host ("[MISSING] {0,-16} not found on PATH  -> {1}" -f $name, $why) -ForegroundColor Red
        return
    }
    $raw = & $cmd $versionArg 2>&1 | Select-Object -First 1
    $verMatch = [regex]::Match([string]$raw, '(\d+)\.(\d+)(\.\d+)?')
    if ($verMatch.Success) {
        $major = [int]$verMatch.Groups[1].Value
        $ver = $verMatch.Value
        if ($minMajor -and $major -lt $minMajor) {
            Write-Host ("[TOO OLD] {0,-16} v{1}  (need v{2}+)  -> {3}" -f $name, $ver, $minMajor, $why) -ForegroundColor Yellow
        } else {
            Write-Host ("[OK]      {0,-16} v{1}" -f $name, $ver) -ForegroundColor Green
        }
    } else {
        Write-Host ("[OK]      {0,-16} found ({1})" -f $name, ([string]$raw).Trim()) -ForegroundColor Green
    }
}

Write-Host "`n=== Fuel Tracker : environment prerequisites ===`n" -ForegroundColor Cyan

Test-Tool "Node.js"     "node"    "--version"  20 "REQUIRED. Install Node 20 LTS from nodejs.org"
Test-Tool "npm"         "npm"     "--version"  10 "Comes with Node 20 LTS"
Test-Tool "Git"         "git"     "--version"  2  "REQUIRED for version control. git-scm.com"
Test-Tool "Docker"      "docker"  "--version"  0  "For local Postgres in dev. Docker Desktop (optional if using native Postgres)"
Test-Tool "Claude Code" "claude"  "--version"  0  "REQUIRED. The build agent"
Test-Tool "VS Code CLI" "code"    "--version"  0  "Lets scripts manage extensions"

# Docker daemon actually running?
Write-Host ""
$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK]      Docker daemon    running (Postgres container will work)" -ForegroundColor Green
} else {
    Write-Host "[WARN]    Docker daemon    not running -> start Docker Desktop before 'docker compose up'" -ForegroundColor Yellow
}

# Port 3000 (dev server) and 5432 (Postgres) free?
Write-Host ""
foreach ($p in 3000, 5432) {
    $inUse = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Host ("[WARN]    Port {0,-5}       in use -> free it or the app/DB may fail to start" -f $p) -ForegroundColor Yellow
    } else {
        Write-Host ("[OK]      Port {0,-5}       free" -f $p) -ForegroundColor Green
    }
}

# Recommended VS Code extensions
Write-Host "`n=== VS Code extensions ===`n" -ForegroundColor Cyan
$installed = code --list-extensions 2>$null
$want = @(
    @("Prisma.prisma",                 "Prisma schema support"),
    @("bradlc.vscode-tailwindcss",     "Tailwind class autocomplete"),
    @("dbaeumer.vscode-eslint",        "ESLint"),
    @("esbenp.prettier-vscode",        "Prettier formatting"),
    @("usernamehw.errorlens",          "Inline errors"),
    @("yoavbls.pretty-ts-errors",      "Readable TS errors"),
    @("eamodio.gitlens",               "Git history / review changes"),
    @("csstools.postcss",              "PostCSS / Tailwind directives")
)
if (-not $installed) {
    Write-Host "[WARN] Could not list extensions ('code' CLI unavailable). Install manually in VS Code." -ForegroundColor Yellow
} else {
    foreach ($e in $want) {
        if ($installed -contains $e[0]) {
            Write-Host ("[OK]      {0,-30} {1}" -f $e[0], $e[1]) -ForegroundColor Green
        } else {
            Write-Host ("[MISSING] {0,-30} {1}" -f $e[0], $e[1]) -ForegroundColor Red
        }
    }
}

Write-Host "`nDone. Fix anything RED before starting Phase 0. YELLOW = optional / attention.`n" -ForegroundColor Cyan