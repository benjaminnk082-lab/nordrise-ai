# Nordrise AI — Sean

Personal AI assistant named **Sean**. Runs headless Claude Code (`claude -p`) so all traffic stays on the Claude Max subscription instead of paid per-token API. MVP interface: Telegram bot, single-user (whitelist).

```
Telegram webhook
      ↓
Express gateway  (auth: webhook secret + user whitelist + rate limit)
      ↓
SessionManager   (Postgres: sessionId per telegramChatId, 24h inactivity rotates)
      ↓
ClaudeBridge     (spawns `claude -p --resume <id> --output-format stream-json`)
      ↓
Railway Volume   (/app/workspace for filesystem, /app/.claude for OAuth cache)
```

## Requirements

- Node 20+
- Docker (for local container testing; Railway builds via `Dockerfile`)
- A Claude Max subscription (Pro/Team also works if it includes Claude Code)
- `@anthropic-ai/claude-code` CLI installed locally (`install.ps1` / `install.sh` does this)
- A Telegram bot from [@BotFather](https://t.me/BotFather)

## Quick start

### Windows

```powershell
git clone https://github.com/REPLACE_ME/nordrise-ai.git
cd nordrise-ai
.\install.ps1
```

### macOS / Linux

```bash
git clone https://github.com/REPLACE_ME/nordrise-ai.git
cd nordrise-ai
./install.sh
```

The installer:
1. Verifies Node 20+, npm, git.
2. Runs `npm install`.
3. Installs `@anthropic-ai/claude-code` globally (pinned version).
4. Creates `.env` from `.env.example`, auto-generates `TELEGRAM_WEBHOOK_SECRET`, prompts for the rest.
5. Runs `prisma generate`.

After install:

```bash
claude setup-token              # generates CLAUDE_CODE_OAUTH_TOKEN (paste into .env)
npm run verify-auth             # must print "authMode=subscription"
npm run bridge-repl             # talk to Sean in the terminal, confirm stream works
```

## Environment variables

See [`.env.example`](./.env.example). The critical one:

> **Never set `ANTHROPIC_API_KEY`.** The app boots with `unset ANTHROPIC_API_KEY` in the entrypoint and hard-fails if a `claude -p` test call reports any cost (`total_cost_usd > 0`).

Required:
- `CLAUDE_CODE_OAUTH_TOKEN` — long-lived OAuth token from `claude setup-token` (~1 year validity, rotate manually)
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_WEBHOOK_SECRET` — 32-byte hex (generator: `npm run gen-secret`)
- `ALLOWED_TELEGRAM_USER_IDS` — comma-separated Telegram user IDs
- `DATABASE_URL` — Railway auto-injects for Postgres plugin
- `GATEWAY_PUBLIC_URL` — Railway domain, used by `scripts/set-webhook.ts`

Tunables: `SESSION_TIMEOUT_HOURS` (24), `CLAUDE_CALL_TIMEOUT_MS` (120000), `RATE_LIMIT_MAX_MESSAGES` (20), `RATE_LIMIT_WINDOW_MS` (60000).

## Deploy to Railway

1. Push this repo to GitHub (see *Push to GitHub* below).
2. Railway → **New project** → *Deploy from GitHub repo* → pick `nordrise-ai`.
3. Add the **Postgres** plugin. `DATABASE_URL` is injected automatically.
4. Add a **Volume**, mount at `/app/.claude` (persists the OAuth cache so Sean doesn't re-auth each deploy).
5. Add another **Volume**, mount at `/app/workspace` (Sean's filesystem).
6. Set env vars in the Railway dashboard: `CLAUDE_CODE_OAUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ALLOWED_TELEGRAM_USER_IDS`, `GATEWAY_PUBLIC_URL`.
7. Deploy. The entrypoint runs `prisma migrate deploy` and then `scripts/verify-auth.ts` before binding the port.
8. Register the webhook:
   ```bash
   GATEWAY_PUBLIC_URL=https://nordrise-ai.up.railway.app \
   TELEGRAM_BOT_TOKEN=... \
   TELEGRAM_WEBHOOK_SECRET=... \
   npm run set-webhook
   ```

Healthcheck: `GET /healthz` returns `{ status, authMode, db, uptimeSec }`.

## Push to GitHub

The installer templates have `REPLACE_ME` as the org/user. Replace once you've created the repo:

```bash
gh repo create nordrise-ai --private --source . --remote origin --push
# or:
git remote add origin git@github.com:<you>/nordrise-ai.git
git branch -M main
git push -u origin main
```

Then find/replace `REPLACE_ME` in `install.ps1`, `install.sh`, and this README with your GitHub user/org.

## Local dev loop

```bash
# start Postgres in docker
docker run -d --name nordrise-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# apply schema
npm run prisma:migrate:dev

# talk to Sean in your terminal (no HTTP, no Telegram)
npm run bridge-repl

# run the HTTP gateway (requires valid Telegram creds)
npm run dev
```

To test the webhook end-to-end locally, use `ngrok http 3000` and point the bot at it.

## Smoke-test checklist

- [ ] `docker build .` succeeds.
- [ ] Container with an invalid `CLAUDE_CODE_OAUTH_TOKEN` fails at boot (verify-auth exits non-zero).
- [ ] Container with a valid token boots and `/healthz` returns `{ status: "ok", authMode: "subscription" }`.
- [ ] `curl -X POST $URL/telegram -H "X-Telegram-Bot-Api-Secret-Token: wrong"` → 401.
- [ ] Message from a non-whitelisted Telegram user produces no reply; log shows `non-whitelisted telegram user blocked`.
- [ ] Restart the container; session history survives (resume works).
- [ ] Send a message that forces a >4000-char reply; verify Telegram receives multiple cleanly split messages.

## Troubleshooting

**`verify-auth` reports `authMode=api_billed`.** `ANTHROPIC_API_KEY` leaked into the env. Unset it. Check Railway → Variables. The entrypoint also unsets it at boot, so this should only happen if something set it *after* entrypoint ran.

**`verify-auth` reports `claude invocation failed`.** The OAuth token is stale, revoked, or malformed. Regenerate with `claude setup-token` and update the Railway var.

**Sean says "Max-limit truffet".** Claude Max has 5-hour and weekly caps. Wait. No auto-retry.

**Telegram webhook returns 401.** Header `X-Telegram-Bot-Api-Secret-Token` doesn't match. Re-run `npm run set-webhook`.

**Prisma "Can't reach database" at boot.** `DATABASE_URL` unreachable. On Railway, make sure the Postgres plugin is attached to this service.

## Scope

Phase 1 (this repo): Telegram webhook, auth gating, session manager, claude bridge, whitelist, rate limiting, healthcheck.

Out of scope (not built): Discord/WhatsApp/Slack, voice, cron/scheduled tasks, MCP connectors, web UI, multi-user, vector memory, auto token refresh.
