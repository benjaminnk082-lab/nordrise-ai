# =============================================================================
# Nordrise AI — Sean. Windows installer.
#
# Usage (from the repo root, in PowerShell):
#   .\install.ps1
#
# Or one-shot bootstrap (downloads the repo first — replace <org> with your
# GitHub user/org once the repo is pushed):
#   iwr -useb https://raw.githubusercontent.com/<org>/nordrise-ai/main/install.ps1 | iex
#
# What it does:
#   1. Verifies Node 20+, npm, git are installed.
#   2. Clones the repo if not already present.
#   3. Installs npm dependencies.
#   4. Installs @anthropic-ai/claude-code globally (pinned).
#   5. Creates .env from .env.example and generates TELEGRAM_WEBHOOK_SECRET.
#   6. Prompts for the bits only you can provide.
#   7. Prints next steps (claude setup-token, Prisma migrate, deploy).
# =============================================================================

$ErrorActionPreference = 'Stop'

$REPO_URL       = 'https://github.com/REPLACE_ME/nordrise-ai.git'
$REPO_DIR_NAME  = 'nordrise-ai'
$CLAUDE_VERSION = '1.0.60'

function Info($msg)    { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Ok($msg)      { Write-Host "[install] $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "[install] $msg" -ForegroundColor Yellow }
function Fail($msg)    { Write-Host "[install] $msg" -ForegroundColor Red; exit 1 }

function Require-Cmd($name, $hint) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { Fail "$name not found on PATH. $hint" }
}

# ---- 1. Prereqs ----
Info 'checking prerequisites'
Require-Cmd 'node' 'Install Node 20+ from https://nodejs.org/'
Require-Cmd 'npm'  'npm ships with Node.'
Require-Cmd 'git'  'Install Git from https://git-scm.com/'

$nodeRaw = (& node --version).Trim().TrimStart('v')
$nodeMajor = [int]($nodeRaw.Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node 20+ required (found $nodeRaw)" }
Ok "node $nodeRaw, npm $(& npm --version)"

# ---- 2. Clone repo if needed ----
if (-not (Test-Path 'package.json') -or -not (Test-Path 'src/gateway.ts')) {
    if (-not (Test-Path $REPO_DIR_NAME)) {
        Info "cloning $REPO_URL"
        git clone $REPO_URL $REPO_DIR_NAME
    }
    Set-Location $REPO_DIR_NAME
}
Ok "working in $(Get-Location)"

# ---- 3. npm install ----
Info 'installing npm dependencies'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed' }

# ---- 4. Claude Code CLI ----
Info "installing @anthropic-ai/claude-code@$CLAUDE_VERSION globally"
npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@$CLAUDE_VERSION"
if ($LASTEXITCODE -ne 0) { Fail 'claude-code install failed' }

# ---- 5. .env bootstrap ----
if (-not (Test-Path '.env')) {
    Info 'creating .env from .env.example'
    Copy-Item '.env.example' '.env'
} else {
    Warn '.env already exists — leaving it alone'
}

function Set-EnvVar($name, $value) {
    $path = '.env'
    $content = Get-Content $path -Raw
    $escaped = [regex]::Escape($name)
    $line = "$name=$value"
    if ($content -match "(?m)^$escaped=.*$") {
        $content = [regex]::Replace($content, "(?m)^$escaped=.*$", $line)
    } else {
        $content += "`n$line"
    }
    Set-Content -Path $path -Value $content -NoNewline -Encoding utf8
}

function Get-EnvVar($name) {
    $path = '.env'
    if (-not (Test-Path $path)) { return $null }
    $line = Select-String -Path $path -Pattern "^$([regex]::Escape($name))=" -SimpleMatch:$false | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line.Line -replace "^$([regex]::Escape($name))=", '')
}

# TELEGRAM_WEBHOOK_SECRET — auto-generate if still placeholder
$current = Get-EnvVar 'TELEGRAM_WEBHOOK_SECRET'
if (-not $current -or $current -eq 'REPLACE_ME') {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $hex = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    Set-EnvVar 'TELEGRAM_WEBHOOK_SECRET' $hex
    Ok 'generated TELEGRAM_WEBHOOK_SECRET'
}

# TELEGRAM_BOT_TOKEN — prompt
$current = Get-EnvVar 'TELEGRAM_BOT_TOKEN'
if (-not $current -or $current -eq 'REPLACE_ME') {
    $tok = Read-Host 'Paste TELEGRAM_BOT_TOKEN (from @BotFather), or leave blank to skip'
    if ($tok) { Set-EnvVar 'TELEGRAM_BOT_TOKEN' $tok; Ok 'TELEGRAM_BOT_TOKEN saved' }
    else { Warn 'skipped — set it in .env before running `npm run dev`' }
}

# CLAUDE_CODE_OAUTH_TOKEN — prompt (ask to run setup-token if empty)
$current = Get-EnvVar 'CLAUDE_CODE_OAUTH_TOKEN'
if (-not $current -or $current -eq 'sk-ant-oat01-REPLACE_ME') {
    Warn 'CLAUDE_CODE_OAUTH_TOKEN is not set.'
    Write-Host '  Run `claude setup-token` in another terminal, then paste the token here.'
    $tok = Read-Host 'CLAUDE_CODE_OAUTH_TOKEN (leave blank to skip)'
    if ($tok) { Set-EnvVar 'CLAUDE_CODE_OAUTH_TOKEN' $tok; Ok 'CLAUDE_CODE_OAUTH_TOKEN saved' }
    else { Warn 'skipped — set it in .env before running `npm run verify-auth`' }
}

# ---- 6. Prisma generate ----
Info 'running prisma generate'
npx prisma generate --schema=./prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { Warn 'prisma generate failed (not fatal until DATABASE_URL is reachable)' }

# ---- 7. Done ----
Ok 'install complete'
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor White
Write-Host '  1. Make sure .env has CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, DATABASE_URL.'
Write-Host '  2. Verify auth:               npm run verify-auth'
Write-Host '  3. Try the bridge locally:    npm run bridge-repl'
Write-Host '  4. Apply DB migrations:       npm run prisma:migrate:dev'
Write-Host '  5. Run dev server:            npm run dev'
Write-Host '  6. Register Telegram webhook after deploy:  npm run set-webhook'
Write-Host ''
