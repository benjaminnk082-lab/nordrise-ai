#!/usr/bin/env bash
# =============================================================================
# Nordrise AI — Sean. Unix installer.
#
# Usage (from repo root):
#   ./install.sh
#
# One-shot bootstrap (replace <org> once the repo is on GitHub):
#   curl -fsSL https://raw.githubusercontent.com/<org>/nordrise-ai/main/install.sh | bash
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/REPLACE_ME/nordrise-ai.git"
REPO_DIR_NAME="nordrise-ai"
CLAUDE_VERSION="1.0.60"

info() { printf '\033[36m[install]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[install]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[install]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 not found. $2"
}

# ---- 1. Prereqs ----
info "checking prerequisites"
require_cmd node "Install Node 20+ from https://nodejs.org/"
require_cmd npm  "npm ships with Node."
require_cmd git  "Install git."

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [ "${node_major}" -lt 20 ]; then
    fail "Node 20+ required (found $(node --version))"
fi
ok "node $(node --version), npm $(npm --version)"

# ---- 2. Clone if needed ----
if [ ! -f package.json ] || [ ! -f src/gateway.ts ]; then
    if [ ! -d "$REPO_DIR_NAME" ]; then
        info "cloning $REPO_URL"
        git clone "$REPO_URL" "$REPO_DIR_NAME"
    fi
    cd "$REPO_DIR_NAME"
fi
ok "working in $(pwd)"

# ---- 3. npm install ----
info "installing npm dependencies"
npm install --no-audit --no-fund

# ---- 4. Claude Code CLI ----
info "installing @anthropic-ai/claude-code@${CLAUDE_VERSION} globally"
if ! npm install -g --no-audit --no-fund "@anthropic-ai/claude-code@${CLAUDE_VERSION}"; then
    warn "global install failed (permissions?). Try: sudo npm install -g @anthropic-ai/claude-code@${CLAUDE_VERSION}"
fi

# ---- 5. .env bootstrap ----
if [ ! -f .env ]; then
    info "creating .env from .env.example"
    cp .env.example .env
else
    warn ".env already exists — leaving it alone"
fi

set_env_var() {
    local key="$1" val="$2" tmp
    tmp="$(mktemp)"
    if grep -qE "^${key}=" .env; then
        awk -v key="$key" -v val="$val" 'BEGIN{FS=OFS="="} $1==key {$0=key"="val; print; next} {print}' .env > "$tmp"
    else
        cp .env "$tmp"
        printf '\n%s=%s\n' "$key" "$val" >> "$tmp"
    fi
    mv "$tmp" .env
}

get_env_var() {
    grep -E "^$1=" .env 2>/dev/null | head -n1 | sed -E "s/^$1=//"
}

if [ "$(get_env_var TELEGRAM_WEBHOOK_SECRET)" = "REPLACE_ME" ] || [ -z "$(get_env_var TELEGRAM_WEBHOOK_SECRET)" ]; then
    hex="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
    set_env_var TELEGRAM_WEBHOOK_SECRET "$hex"
    ok "generated TELEGRAM_WEBHOOK_SECRET"
fi

if [ "$(get_env_var TELEGRAM_BOT_TOKEN)" = "REPLACE_ME" ] || [ -z "$(get_env_var TELEGRAM_BOT_TOKEN)" ]; then
    read -r -p "Paste TELEGRAM_BOT_TOKEN (or blank to skip): " tok
    if [ -n "${tok:-}" ]; then set_env_var TELEGRAM_BOT_TOKEN "$tok"; ok "TELEGRAM_BOT_TOKEN saved"; fi
fi

if [ "$(get_env_var CLAUDE_CODE_OAUTH_TOKEN)" = "sk-ant-oat01-REPLACE_ME" ] || [ -z "$(get_env_var CLAUDE_CODE_OAUTH_TOKEN)" ]; then
    warn "CLAUDE_CODE_OAUTH_TOKEN not set. Run \`claude setup-token\` in another terminal."
    read -r -p "Paste CLAUDE_CODE_OAUTH_TOKEN (or blank to skip): " tok
    if [ -n "${tok:-}" ]; then set_env_var CLAUDE_CODE_OAUTH_TOKEN "$tok"; ok "CLAUDE_CODE_OAUTH_TOKEN saved"; fi
fi

# ---- 6. Prisma generate ----
info "running prisma generate"
npx prisma generate --schema=./prisma/schema.prisma || warn "prisma generate failed (not fatal without DATABASE_URL yet)"

# ---- 7. Done ----
ok "install complete"
cat <<'EOF'

Next steps:
  1. Ensure .env has CLAUDE_CODE_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, DATABASE_URL.
  2. Verify auth:               npm run verify-auth
  3. Try the bridge locally:    npm run bridge-repl
  4. Apply DB migrations:       npm run prisma:migrate:dev
  5. Run dev server:            npm run dev
  6. Register Telegram webhook: npm run set-webhook   (after Railway deploy)

EOF
