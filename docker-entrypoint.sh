#!/usr/bin/env bash
# docker-entrypoint.sh
# Runs at container start. Hard-fails boot if auth isn't subscription mode.
set -euo pipefail

echo "[entrypoint] starting — node $(node --version), pwd=$(pwd)"
echo "[entrypoint] DATABASE_URL set: ${DATABASE_URL:+yes}"
echo "[entrypoint] OAUTH token set: ${CLAUDE_CODE_OAUTH_TOKEN:+yes}"
echo "[entrypoint] TELEGRAM_BOT_TOKEN set: ${TELEGRAM_BOT_TOKEN:+yes}"

# 1. Never allow paid API billing. Strip the var even if something set it.
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "[entrypoint] WARN: ANTHROPIC_API_KEY was set in env — unsetting to force subscription auth"
  unset ANTHROPIC_API_KEY
fi

# 2. Ensure the workspace and claude credential dirs exist (Railway volumes mount here)
mkdir -p "${WORKSPACE_DIR:-/app/workspace}" "/app/.claude"

# 3. Sync DB schema. Prefer migrate deploy when migrations exist, else db push.
if [[ -n "${DATABASE_URL:-}" ]]; then
  if [[ -d ./prisma/migrations ]] && ls ./prisma/migrations/*/migration.sql >/dev/null 2>&1; then
    echo "[entrypoint] running prisma migrate deploy"
    npx prisma migrate deploy --schema=./prisma/schema.prisma || {
      echo "[entrypoint] prisma migrate deploy failed"
      exit 3
    }
  else
    echo "[entrypoint] no migrations dir — running prisma db push (initial setup)"
    npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss --skip-generate || {
      echo "[entrypoint] prisma db push failed"
      exit 3
    }
  fi
fi

# 4. Hard-gate the boot on subscription auth
echo "[entrypoint] verifying Claude Max subscription auth"
node --enable-source-maps ./dist/scripts/verify-auth.js

# 5. Clone or update the public Nordrise-AI repo so Sean can read his own code.
# Non-fatal — if the network is down or rate-limited, Sean still boots; he
# just won't have the live reference until the next 30-min pull (in
# src/gateway.ts) or the next restart.
#
# GIT_TERMINAL_PROMPT=0 + GIT_ASKPASS=true: the repo is public so git should
# never need credentials, but a misconfigured credential.helper or stale
# checkout can cause git to block on a username prompt. These envs make git
# fail fast instead.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
CODEBASE_DIR="${WORKSPACE_DIR:-/app/workspace}/codebase"
GIT_REPO_URL="${NORDRISE_REPO_URL:-https://github.com/BennyK-tech/Nordrise-AI.git}"

if [[ -d "$CODEBASE_DIR/.git" ]]; then
  echo "[entrypoint] pulling latest codebase into $CODEBASE_DIR"
  # Make sure remote URL is the public HTTPS one (in case it was set with credentials previously)
  git -C "$CODEBASE_DIR" remote set-url origin "$GIT_REPO_URL" 2>/dev/null || true
  git -c credential.helper= -C "$CODEBASE_DIR" fetch --depth=1 origin main || echo "[entrypoint] codebase fetch failed (non-fatal)"
  git -c credential.helper= -C "$CODEBASE_DIR" reset --hard origin/main || echo "[entrypoint] codebase reset failed (non-fatal)"
else
  echo "[entrypoint] cloning codebase to $CODEBASE_DIR"
  rm -rf "$CODEBASE_DIR"
  git -c credential.helper= clone --depth=1 "$GIT_REPO_URL" "$CODEBASE_DIR" || echo "[entrypoint] codebase clone failed (non-fatal)"
fi

# 6. Hand off to the app
echo "[entrypoint] auth ok — starting gateway"
exec node --enable-source-maps ./dist/src/gateway.js
