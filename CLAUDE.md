# CLAUDE.md — Nordrise AI ("Sean")

> Operations contract for autonomous agents working on this monorepo. Loaded into context at the start of every session. Read the relevant subsection before touching its surface.
>
> Last regenerated: 2026-05-05 against `main` @ `e16b768` (v0.5.2). Conventions in this file override `README.md` and `docs/sean-handoff.md` where they disagree (both are partly stale).

---

## 1. What this is

Two surfaces, one repo:

1. **Gateway** (`src/`) — Express service on Railway (`sean-production-d872.up.railway.app`). Receives Telegram webhooks and serves the desktop app's `/control/*` API. All Claude calls go through the `claude -p` subprocess on the **Claude Max subscription** (auth via `CLAUDE_CODE_OAUTH_TOKEN`). The paid API is forbidden — see §6.
2. **Desktop client** (`apps/control/`) — Electron 33 + Next.js 14 app distributed as a Windows installer ("Nordrise Control"). Auto-updates from GitHub Releases triggered by tags `control-v*`.

Telegram and desktop traffic share the gateway but have **separate** session managers and route prefixes (`/telegram` vs `/control/*`).

GitHub remote: `benjaminnk082-lab/nordrise-ai`. The legacy URL `BennyK-tech/Nordrise-AI` still appears in `src/config.ts` (`NORDRISE_REPO_URL` default) and in `docs/sean-handoff.md`; that's the rough edge — see §8.

---

## 2. Stack

### Gateway (`src/`)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node 20+ ESM (`"type":"module"`) | tsconfig `module: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: false` |
| Web | Express 4.21 + zod 3.23 | Hard 1 MB JSON limit; empty bodies rejected up-front |
| DB | PostgreSQL via Prisma 5.22 | `prisma/schema.prisma`. **No `prisma/migrations/` folder** — schema applied via `prisma db push`; Dockerfile entrypoint runs `prisma migrate deploy` only when migrations exist (see §6) |
| Test | vitest 2.1 (`vitest.config.ts`) | node env, single-fork pool, `setupFiles: src/test-setup.ts` |
| Telegram | grammy 1.30 | `src/channels/telegram.ts` |
| Logging | pino 9.5 + pino-pretty | Redact paths declared in `src/logger.ts` |
| Files | multer 1.4 + `file-type` magic-byte sniff | 25 MB cap (`uploadRoute.ts`) |
| Cron | node-cron 3.0 | Routines, suggestions, proactive engine, app-improvement watcher |
| Embedded PG | `embedded-postgres` 16.13 (devDep) | `scripts/start-embedded-pg.mjs` — replacement for Docker Postgres on Windows dev machines (port 5432, user/pass `postgres`) |

### Desktop (`apps/control/`)

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron 33.2.0 | `main` ESM bundle at `dist/main/index.js` |
| Renderer | Next.js 14.2.18 (app router, **static export**) | `npm run build:renderer` → `renderer/out/` → copied into `dist/renderer` and served via custom `app://` protocol |
| UI | React 18.3 + Tailwind 3.4 + react-markdown 9 + rehype-highlight 7 + highlight.js 11 | **Visual styling lives in plain CSS in `globals.css`, not Tailwind utilities** (see §6) |
| Local DB | better-sqlite3 11.5 | Quick-tasks store at `app.getPath('userData')/data.db` (`main/store.ts`) |
| Secret store | keytar 7.9 with `safeStorage` fallback | `main/keychain.ts` — `bearer` slot for control token, `claude-oauth` slot for per-user Claude token |
| Watcher | chokidar 4 | Vault sync (`main/vaultSync.ts`) |
| Updater | electron-updater 6.3 | NSIS installer; auto-update gated on `manualCheck()` + `pending-update` IPC |
| Test | vitest 2.1 (`apps/control/vitest.config.ts`) | jsdom env; covers `renderer/**`, `main/**`, `src/**` |
| Build | electron-builder 25 | Tags `control-v*` trigger `release-control.yml` workflow on `windows-latest` |

Three-tsconfig setup in `apps/control/`:

- `tsconfig.json` — renderer+app glue (default `npm run typecheck` runs all three)
- `tsconfig.main.json` — `main/` only, output to `dist/main`, no DOM lib
- `tsconfig.preload.json` — `preload/` only

The root `tsconfig.json` includes ONLY `src/**` and `scripts/**`. **`apps/**` is not part of the gateway typecheck.** CI's `npm run typecheck` covers gateway only; control has its own typecheck command.

---

## 3. Architecture

```
                        ┌─────────────────────────────┐
                        │   Telegram (mobile)         │
                        │   webhook → /telegram        │
                        └──────────────┬──────────────┘
                                       │ HTTPS + secret header
                                       │
        ┌──────────────────────────────▼────────────────────────────────┐
        │  Express gateway (src/gateway.ts) — Railway                   │
        │                                                                │
        │   /telegram     →  channels/telegram.ts                        │
        │                       └→ SessionManager (TG ↔ claudeSession)  │
        │                                                                │
        │   /control/*    →  Bearer auth (CONTROL_API_TOKENS allowlist) │
        │                       ├→ messageRoute      (POST, SSE stream) │
        │                       ├→ sessionsRoute     (CRUD threads)     │
        │                       ├→ historyRoute      (telegram bridge)  │
        │                       ├→ uploadRoute       (multipart, 25 MB) │
        │                       ├→ vaultRoute        (Obsidian sync)    │
        │                       ├→ routinesRoute     (cron tasks)       │
        │                       ├→ suggestionsRoute  (proactive queue)  │
        │                       ├→ personaRoute      (Sean's prompt)    │
        │                       ├→ proactiveRoute    (autonomous send)  │
        │                       └→ appImprovementRt  (self-improvement) │
        │                                                                │
        │   Postgres (Prisma) — Session, ControlSession, Message,        │
        │     Reaction, MemoryNote, Routine, RoutineRun, Suggestion,    │
        │     ProactiveAttempt, ProactiveSettings, AppImprovement       │
        │                                                                │
        │   ClaudeBridge.invoke()                                        │
        │     spawn('claude', ['-p', text, '--output-format',           │
        │            'stream-json', '--verbose',                         │
        │            '--resume', sessionId?, '--model', model?,          │
        │            '--append-system-prompt', persona+extras])          │
        │                                                                │
        │   Railway volumes:                                             │
        │     /app/.claude       — claude-code OAuth cache               │
        │     /app/workspace/    — Sean's filesystem                     │
        │       ├── inbox/         (uploads, 7d cleanup)                 │
        │       ├── vault/         (PC → Sean Obsidian sync target)     │
        │       ├── sean-notes/    (Sean → PC suggestion queue)         │
        │       └── codebase/      (auto-pulled NORDRISE_REPO_URL)       │
        └────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ HTTPS + Bearer token
                                       │ + ephemeral connectorKeys / claudeAuthToken
                                       │
        ┌──────────────────────────────┴─────────────────────────────────┐
        │  Nordrise Control (Electron)                                   │
        │                                                                │
        │   ┌─ main/ (Node) ─────────────────────────────────────────┐  │
        │   │  index.ts       window+protocol+lifecycle              │  │
        │   │  ipc.ts         all IPC handlers (see §4)              │  │
        │   │  keychain.ts    keytar / safeStorage fallback          │  │
        │   │  settingsStore  JSON @ userData/settings.json          │  │
        │   │  store.ts       SQLite @ userData/data.db (qt:*)       │  │
        │   │  vaultSync.ts   chokidar watcher → /control/vault/*   │  │
        │   │  persona.ts     fetch+cache GET /control/persona       │  │
        │   │  ollama.ts      localhost streaming, no Sean involved  │  │
        │   │  teamsOAuth.ts  loopback HTTP code-flow → MS Graph    │  │
        │   │  vismaCookie    embedded BrowserWindow harvest         │  │
        │   │  autoUpdate.ts  electron-updater                       │  │
        │   │  hotkeys.ts     Ctrl+Shift+S/L globals                 │  │
        │   │  popup.ts       mini-popup                             │  │
        │   │  tray.ts        red/yellow/green health pill           │  │
        │   └────────────────────────────────────────────────────────┘  │
        │              │ contextBridge: window.nordrise = {invoke, on}  │
        │   ┌─ preload/ ─┴────────────────────────────────────────────┐  │
        │   │  index.ts   exposes 'nordrise' global                   │  │
        │   └──────────────────────────────────────────────────────────┘  │
        │              │                                                 │
        │   ┌─ renderer/ (Next.js) ──────────────────────────────────┐   │
        │   │  app/page.tsx, app/popup/page.tsx, app/layout.tsx     │   │
        │   │  components/AppShell, ChatPane, ThreadList,            │   │
        │   │     CommandPalette (Cmd+K), ConnectorRail,             │   │
        │   │     Composer, Message, ThinkingPanel, PinnedPanel,     │   │
        │   │     SeanNotesPanel, RoutinesSection, ProactiveSection,│   │
        │   │     SuggestionsPanel, GlobalSearch, SettingsModal,     │   │
        │   │     ThreadSettingsModal, PermissionModePill,           │   │
        │   │     QuickTaskManager/Palette, TelegramHistory,         │   │
        │   │     ThemeApplier, Stage, TokenLogin, …                 │   │
        │   │  state/thread.ts  useReducer over server+drafts        │   │
        │   │  hooks/useStream.ts                                    │   │
        │   │  lib/api.ts       typed wrappers around control:fetch  │   │
        │   │  lib/bridge.ts    storedToken, version, pendingUpdate │   │
        │   │  lib/settings.ts  IPC settings:* facade                │   │
        │   │  lib/vault.ts, cron.ts, proactive.ts, quickTasks.ts,  │   │
        │   │  lib/routing.ts   simple/complex classifier (Ollama)   │   │
        │   └─────────────────────────────────────────────────────────┘  │
        │                                                                │
        │   IPC channels: app:*, auth:*, claude-auth:*, config:*,       │
        │     healthz, control:fetch, control:upload, control:stream-*, │
        │     qt:*, settings:*, window:*, shell:*, ollama:*, popup:*,   │
        │     vault:*, routines:notify, teams:oauth-start,              │
        │     visma:capture-cookie                                       │
        └────────────────────────────────────────────────────────────────┘
```

---

## 4. IPC contract (renderer ↔ main)

The renderer **never** fetches the backend directly — `app://` origin would trigger CORS preflight on `Authorization` which the gateway does not handle. Every backend interaction routes through main via the `nordrise` bridge.

The bridge is exposed in `apps/control/preload/index.ts`:

```ts
window.nordrise = {
  invoke<T>(channel, payload?): Promise<T>     // request/response (ipcRenderer.invoke)
  on(channel, listener): unsubscribe           // streaming events (ipcRenderer.on)
  platform, versions: { node, electron }
}
```

### Channel inventory (registered in `main/ipc.ts`)

| Channel | Direction | Purpose |
|---|---|---|
| **App lifecycle** |||
| `app:version` | invoke | `app.getVersion()` |
| `app:pending-update` | invoke | electron-updater pending version |
| `app:quit-and-install` | invoke | trigger update install on next quit |
| `app:update-status` | invoke | detailed updater state |
| `app:update-log` | invoke | scroll-back of updater events |
| `app:update-check` | invoke | manual `checkForUpdates()` |
| **Auth tokens** |||
| `auth:get-token` / `auth:set-token` / `auth:clear-token` | invoke | bearer for `/control/*`, slot `bearer` |
| `auth:verify-token` | invoke | round-trip GET `/control/sessions` |
| `claude-auth:get-token` / `:set-token` / `:clear-token` | invoke | per-user OAuth `sk-ant-oat01-…`, slot `claude-oauth` |
| `claude-auth:test` | invoke | client-side format/length check (no API call) |
| **Backend bridge** |||
| `config:backend-url` | invoke | env override or default `sean-production-d872.up.railway.app` |
| `healthz` | invoke | `GET /healthz` |
| `control:fetch` | invoke | generic JSON fetch (path/method/body); attaches Bearer; returns `{ok, status, body}` |
| `control:upload` | invoke | multipart POST `/control/upload`; renderer reads `File` to ArrayBuffer, main reconstructs FormData |
| `control:stream-start` | invoke + `control:stream-event:<id>` | SSE consumer for `/control/message`; emits `thinking`/`session`/`partial`/`tool`/`done`/`error` and a synthetic `done-stream` terminator |
| `control:stream-abort` | invoke | abort active stream by id |
| **Quick-tasks (SQLite)** |||
| `qt:list` / `qt:get` / `qt:create` / `qt:update` / `qt:delete` | invoke | better-sqlite3-backed |
| **Settings** |||
| `settings:get` / `settings:set` / `settings:reset` | invoke | `userData/settings.json`; see `AppSettings` in `main/settingsStore.ts` |
| **Window / shell** |||
| `window:set-opacity` | invoke | clamp `[0.7, 1.0]`; sender-window only |
| `shell:open-path` | invoke | OS default app for local path |
| `shell:open-external` | invoke | http/https only; `file://`/`javascript:` rejected |
| **Local LLM (Ollama)** |||
| `ollama:detect` / `ollama:list-models` | invoke | localhost-only |
| `ollama:stream-start` + `control:stream-event:<id>` | invoke | injects Sean persona via `system` for cross-model identity; persists prompt/reply through `POST /control/sessions/:id/messages` after stream completes |
| `ollama:stream-abort` | invoke | abort by id |
| **Popup / hotkeys / notifications** |||
| `popup:close` | invoke | hide mini-popup |
| `popup:reply` | invoke | desktop notification when assistant finishes; click focuses main |
| `routines:notify` | invoke | desktop notification on routine completion |
| **Vault (Obsidian)** |||
| `vault:status` | invoke + broadcast on change | `{enabled, lastSyncAt, fileCount, pending, error?, root?}` |
| `vault:start` / `vault:stop` / `vault:resync` | invoke | chokidar watcher lifecycle |
| `vault:pick-folder` | invoke | open folder dialog |
| `vault:list-sean-notes` | invoke | server-side queue at `/app/workspace/sean-notes/` |
| `vault:adopt-note` | invoke | copy server note → `<vault>/Sean/<path>` (rename-on-conflict, never overwrite) |
| `vault:dismiss-note` | invoke | DELETE from server queue |
| `vault:auto-merged` | broadcast | emitted when the 60s auto-merger adopts notes (gated on `permissions.vaultWrite === 'auto'`) |
| **Connector OAuth flows** |||
| `teams:oauth-start` | invoke | loopback `127.0.0.1:<random>/callback`, MS auth code → refresh token; CSRF-protected via state nonce; 5-min timeout |
| `visma:capture-cookie` | invoke | embedded BrowserWindow harvest of `JSESSIONID` after manual login |

### Auth handshake (renderer → main → backend)

1. First boot: `auth:get-token` returns `null` → renderer shows `TokenLogin`.
2. User pastes a `CONTROL_API_TOKENS` entry → `auth:verify-token` does a round-trip → on `200 OK` the renderer calls `auth:set-token` (keytar/safeStorage) → renderer enters app phase.
3. Every subsequent `control:fetch`/`control:upload`/`control:stream-start` reads the slot via `getToken('bearer')` and adds `Authorization: Bearer <t>`.
4. The optional per-user Claude OAuth token (slot `claude-oauth`) is read **only** in `control:stream-start` and forwarded as `claudeAuthToken` in the request body. The renderer never sees this value; main reads it directly.

### SSE frame shape

Source-of-truth: `src/api/control/types.ts`. Mirrored to `apps/control/src/server-types.ts` by `npm run sync-control-types`. Frame union:

```ts
type SseEvent =
  | { event: 'thinking';  data: { at: number } }
  | { event: 'session';   data: { claudeSessionId: string; controlSessionId: string } }
  | { event: 'partial';   data: { text: string } }
  | { event: 'tool';      data: { name; input?; output?; status: 'running'|'done' } }
  | { event: 'done';      data: { durationMs; costUsdInformational; isError } }
  | { event: 'error';     data: { message; retryAfterMs? } }
  | { event: 'heartbeat'; data: Record<string, never> }
```

Plus the synthetic `done-stream` injected by main after the underlying SSE response ends.

---

## 5. HTTP / auth contract (gateway)

### Auth model

- **Telegram**: `POST /telegram` checks header `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET`. Whitelist `ALLOWED_TELEGRAM_USER_IDS` enforced inside `handleUpdate`.
- **Health**: `GET /healthz` is unauthenticated (intentional — Railway probes + desktop tray pill poll it every 30s).
- **Control**: every `/control/*` route is wrapped by `makeRequireControlToken` (`src/api/control/auth.ts`). It expects `Authorization: Bearer <t>` where `<t>` is in the comma-separated `CONTROL_API_TOKENS` env. Constant-time compare via `timingSafeEqual`. Empty allowlist → all calls fail.

### Token issuance

`scripts/issue-control-token.ts` prints a fresh 32-byte hex token. Add to Railway env: `CONTROL_API_TOKENS="<existing>,<new>"`. Then paste the new value into the desktop login screen.

### Endpoint inventory (under `/control/`)

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /persona` | — | `{ persona, sha1, length }` (Sean's `src/prompts/sean.md`) |
| `GET /sessions` | — | `{ sessions: ControlSessionSummary[] }` |
| `POST /session/new` | `{}` | `ControlSessionSummary` |
| `GET /sessions/:id/messages?since=` | — | `{ messages: ControlMessageRow[] }` (incl. reaction + pinned + source) |
| `POST /sessions/:id/messages` | `{ role, content, model? }` | persists row (used by Ollama path) |
| `PATCH /sessions/:id` | `{ title?, systemPrompt? }` | rename / set per-thread system prompt |
| `POST /sessions/:id/archive` | `{}` | archive thread |
| `POST /message` | `{ controlSessionId, text, attachments?, model?, connectorKeys?, claudeAuthToken?, permissionMode?, effectivePermissions? }` | **SSE** (see §4 frame shape) |
| `POST /upload` | multipart `file` | `{ fileId, workspacePath, filename, size }` (≤25 MB, magic-byte sniffed) |
| `GET /history?source=telegram&limit=` | — | `{ messages }` |
| `POST /messages/:id/reaction` | `{ value: 'up'\|'down' }` | upserts |
| `DELETE /messages/:id/reaction` | — | idempotent |
| `POST /messages/:id/pin` | `{}` | toggles, returns new state |
| `GET /messages/pinned` | — | `{ pinned: PinnedMessage[] }` |
| `GET /vault/manifest` | — | `{ files: { path, size, mtime, sha256 }[] }` |
| `POST /vault/files` | multipart `path`, `file` | upload |
| `DELETE /vault/files?path=` | — | remote delete |
| `GET /vault/sean-notes` | — | `{ notes: SeanNote[] }` |
| `DELETE /vault/sean-notes?path=` | — | dequeue |
| `GET /vault/search?q=` | — | `{ matches: VaultSearchMatch[] }` |
| `GET /routines` | — | `{ routines }` |
| `POST /routines` | `RoutineCreateInput` | created row |
| `PATCH /routines/:id` | `RoutinePatchInput` | updated row |
| `DELETE /routines/:id` | — | — |
| `POST /routines/:id/run` | `{}` | fire-and-forget run |
| `GET /routines/:id/runs` | — | history |
| `GET /routines/runs/recent` | — | global recent |
| `GET /routine-library` | — | curated templates |
| `GET /suggestions?status=` | — | `{ suggestions }` |
| `POST /suggestions/:id/approve` / `:id/reject` | `{}` | transition |
| `DELETE /suggestions/:id` | — | — |
| `POST /suggestions/generate-now` | `{}` | force a generator tick |
| `GET /proactive/attempts` | — | audit log |
| `GET /proactive/settings` / `PATCH /proactive/settings` | — / `Partial<ProactiveSettingsRow>` | singleton row |
| `POST /proactive/run-now` | `{}` | one shot |
| `GET /app-improvements` | — | queue list |
| `POST /app-improvements/scan-now` | `{}` | force watcher tick |
| `POST /app-improvements/:id/approve` / `:id/reject` | `{}` | transitions; approve fires Opus spec writer in background |
| `DELETE /app-improvements/:id` | — | — |
| `GET /calibration` | — | reactions bucketed by confidence tag |

### Per-message ephemeral fields

Three fields on `POST /message` are **ephemeral** — they ride the request body and are forwarded into `claude-code`'s spawn env, never persisted:

- `connectorKeys` — known names: `FIRECRAWL_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `VERCEL_TOKEN`, `MS365_MCP_OAUTH_REFRESH_TOKEN`, `MS365_MCP_CLIENT_ID`, `MS365_MCP_TENANT_ID`, `ITSLEARNING_*`, `VISMA_SCHOOL`, `VISMA_COOKIE`. Substituted into `mcp-config/claude-settings.json`.
- `claudeAuthToken` — `sk-ant-oat01-…` per-user OAuth, overrides server's default `CLAUDE_CODE_OAUTH_TOKEN` for that one subprocess.
- `permissionMode` + `effectivePermissions` — appends a system-prompt fragment via `buildPermissionFragment` (see `messageRoute.ts`). `auto` = no fragment, `manual` = ask-before-anything, `custom` = per-action policy from the renderer's `settings.permissions`.

### Health frame

```ts
type HealthzResponse = {
  status: 'ok' | 'degraded';
  authMode: 'subscription';
  db: 'ok' | 'error';
  uptimeSec: number;
  recentMessageCount: number | null;  // 5h window
  service: 'nordrise-ai';
}
```

The desktop tray pill polls every 30s and turns green only when `status === 'ok' && authMode === 'subscription' && db === 'ok'`.

---

## 6. DO NOT BREAK — invariants that must survive every refactor

These are existing behaviors that have already cost time when broken. Treat them as load-bearing.

1. **`ANTHROPIC_API_KEY` is forbidden.** `src/config.ts` calls `mustNotHaveAnthropicApiKey()` at module load and refuses to boot if it's set. `claudeBridge.sanitizedEnv()` strips it again on every spawn. Setting it would silently route all traffic to the paid API. The verify-auth step at boot also hard-fails on `total_cost_usd > 0`. **Never set this var anywhere.**
2. **No `prisma/migrations/` folder in the repo.** Schema is applied via `prisma db push`. If a `migrations/` folder appears, the entrypoint switches to `migrate deploy` which then errors P3005 on the un-baselined prod DB → gateway down. If `prisma migrate dev` ever runs locally, delete the folder before commit.
3. **`apps/control/` is a sibling project, NOT an npm workspace.** Root `Dockerfile` runs `npm ci` against root `package.json` only. Adding `apps/control` to a workspace would pull Electron deps into the gateway image (~500 MB swing) and break Railway. Keep them physically separate.
4. **Renderer never fetches the backend directly.** Every backend call goes through an IPC handler in `main/ipc.ts`. Adding a new endpoint requires a new IPC channel — see §4 inventory. The reason: `app://` origin triggers CORS preflight on `Authorization`, which Sean's API doesn't handle.
5. **Gateway typecheck includes only `src/**` and `scripts/**`.** `apps/control/**` is on a separate typecheck (the desktop app's own `npm run typecheck` chains three tsconfigs). Do not extend root tsconfig to cover `apps/` — it would pull DOM lib types into the gateway and cascade.
6. **Visual styling lives in plain CSS in `apps/control/renderer/app/globals.css`, not Tailwind utilities.** Tailwind is used for layout primitives (flex, grid, spacing) only. Custom theme variables and component looks are CSS variables + plain selectors. A previous attempt with `@layer utilities` for custom classes failed in the packaged app.
7. **`CONTROL_API_TOKENS` always contains at least Benjamin's primary token.** Removing or rotating tokens without updating the desktop client locks it out and there is no recovery flow other than a fresh login. When rotating, **append** the new token first, ship a renderer build that knows about it, then remove the old one.
8. **`sync-control-types.ts` is one-way.** `src/api/control/types.ts` is the source of truth. Hand-editing `apps/control/src/server-types.ts` will be silently overwritten the next time the script runs. Edit the source and run the sync.
9. **Vault adopt-note never overwrites.** `resolveNonClobberPath` renames to `name (2).md`, `name (3).md`, etc. The auto-merger relies on this contract. Removing it would silently destroy notes the user has hand-edited.
10. **Stale-session retry in `claudeBridge`.** When `claude -p --resume <id>` reports "No conversation found with session ID", the bridge retries once without `--resume` and the route updates the persisted `claudeSessionId` from the new result. If that retry is removed, every Railway deploy that rotates the volume will appear as "Sean lost my history" until the user manually starts a new thread.
11. **Conventional-commit + `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer on every commit.** Tags `control-v*` trigger the Windows release workflow; tags `v*` are gateway versions only. Don't push a `control-v*` tag without first verifying `apps/control/npm run typecheck && npm run build` is green.
12. **Permission policy is three-way (`auto` / `manual` / `custom`).** `auto` is the implicit default and produces NO system-prompt fragment — the gateway must continue to send no fragment for `auto`, so existing 0.5.0-and-earlier clients that don't send the field stay backward-compat. The legacy `allPermissionsAuto` boolean in settings.json is a downgrade-safety mirror; both fields must be written together.

13. **Atomic file writes for the Obsidian vault.** When the desktop app
    writes into the user's vault (Sean/HEARTBEAT.md, Sean/memories.md,
    Sean/sessions/*.md, audits/*.json), **always** write to a `.<name>.tmp`
    sibling first and `fs.rename` into place. Obsidian's file watcher
    aggressively re-renders on any size change, so a half-written file
    triggers a flash of broken content (and corrupts the active editor
    if the user is mid-edit). `ObsidianBridge.write*` enforces this; do
    not bypass it with `writeFile` directly.
14. **Skill auto-install requires user confirmation.** A skill is just a
    folder with `SKILL.md` + supporting files; loading one injects the
    body into Sean's context, and supporting files become reachable via
    relative paths in the body. A malicious skill can therefore exfiltrate
    arbitrary vault content the next time Sean is asked to "look at
    project X". Every install MUST surface a confirmation modal showing
    the skill name, source path, and SKILL.md head before writing into
    `<vault>/Sean/skills/`. The registry (`<vault>/Sean/skills-registry/`)
    is local-only — never auto-fetch from the internet.
15. **Heartbeat must pause when the app is focused.** The heartbeat tick
    sends prompts to Sean every 30 min by default and surfaces non-OK
    replies as Windows toasts. If a user is in the middle of a manual
    conversation and a heartbeat fires concurrently, two `claude -p`
    subprocesses race for the Max-quota window and one will rate-limit.
    Pause logic lives in `apps/control/main/heartbeat.ts`; the
    `BrowserWindow.isFocused()` check there is load-bearing.
16. **`HEARTBEAT_OK` is a verbatim sentinel.** When Sean's heartbeat reply
    is exactly the string `HEARTBEAT_OK`, the daemon stays silent (no
    toast, no log). Any other reply surfaces. The sentinel is documented
    in the persona at `src/prompts/sean.md` so Sean knows to use it. Do
    not regex-trim or case-fold the comparison — it's intentional that a
    near-miss like `Heartbeat OK` still triggers a toast (so the user
    sees that Sean tried to communicate and the persona drifted).
17. **Phase 3 schema additions stay in `prisma/schema.prisma`; no
    migrations folder.** New models (`Project`, `TokenUsage`,
    `Checkpoint`, `LighthouseAudit`, `SkillInstall`) ship via the same
    `prisma db push` path — see §6.2. Every new field on an existing
    model must be optional/defaulted so a server running an older client
    never sees missing-required-field errors during deploy windows.

> **TODO for Benjamin** — fyll inn 3-5 ekstra invarianter som *du* har blitt bitt av før. Gode kandidater:
> - Proactive engine timing/quiet hours edge cases
> - OAuth-token refresh-format
> - Telegram split-message-grensen
> - Spesifikke Settings-felt som ikke må migrere automatisk

---

## 7. Desktop feature inventory (what the user sees)

Grouped by surface, current as of v0.5.2.

### Login + token
- `TokenLogin` — paste a `CONTROL_API_TOKENS` entry; verified via `auth:verify-token` round-trip; persisted in OS keychain (or `safeStorage`-encrypted blob if keytar is unavailable).
- Optional: per-user Claude OAuth token `sk-ant-oat01-…` (Settings → Auth) — when set, every message spawns claude-code with this token instead of the server's default.

### Three-column shell (`AppShell`)
- **Left** — `ThreadList` (control sessions, last-active sort, archived hidden).
- **Center** — `ChatPane` with `Composer` (text + drag-and-drop attachments via `DropZone`), `Message` rows with markdown rendering, `ThinkingPanel` (streaming "Sean tenker…" status), reaction buttons (👍/👎), pin star.
- **Right** — collapsible panes:
  - `SeanNotesPanel` — Sean's vault proposals with adopt/dismiss
  - `PinnedPanel` — pinned messages across all threads
  - `RoutinesSection` — recurring task list + run-now + last-run preview
  - `ProactiveSection` — autonomous-attempt audit feed
  - `SuggestionsPanel` — Sean's autonomous proposal queue (approve/reject/delete)

### Status pills + tray
- Top bar: `SeanStatusPill` (gateway health), `RoutinesPill`, `SuggestionsPill`, `PermissionModePill` (auto/manual/custom toggle).
- System tray: red/yellow/green pill driven by 30s `/healthz` poll.

### Universal Cmd+K palette (`CommandPalette`, v0.5.0)
- Search threads, switch model (default + per-thread), invoke quick-tasks, jump to settings sections.

### Connector rail (v0.5.0)
- Visible icons for Firecrawl, GitHub, Vercel, Microsoft 365 / Teams, itslearning, Visma. Each click opens `SettingsModal` to that connector's config row. Enabled connectors send their key in every `connectorKeys` body.
- **Teams**: real OAuth code-flow via loopback HTTP listener (`teams:oauth-start` IPC).
- **Visma**: cookie capture via embedded BrowserWindow login (`visma:capture-cookie` IPC).
- **itslearning**: per-school clientId/secret + manual refresh-token paste (no embedded auth flow).

### Per-thread settings (`ThreadSettingsModal`)
- Rename, archive, set per-thread `systemPrompt` (appended after Sean's persona).

### Quick-tasks (`QuickTaskPalette` Cmd+L, `QuickTaskManager`)
- Templated prompts with `{{variable}}` interpolation. SQLite-backed at `userData/data.db`.
- Optional `attachClipboard` flag. Optional global hotkey per task.

### Mini-popup (`Ctrl+Shift+S`, `app/popup/page.tsx`)
- Quick-send window, smaller chrome, closes after send. Reply surfaces as a desktop notification (`popup:reply`).

### Global search (`Ctrl+F`, `GlobalSearch`)
- Searches across all messages + pinned + Sean's vault. Vault search via `GET /control/vault/search?q=`.

### Settings (`SettingsModal`)
- Default model + per-thread overrides
- Ollama config + `preferOllamaForSimple` routing flag
- Connectors (per §above)
- Vault sync (path picker, start/stop/resync, auto-merge interval)
- Permissions tristate per action (`vaultWrite`, `telegramSend`, `webSearch`, `githubAccess`, `shellExec`)
- Permission mode (auto/manual/custom)
- Theme (`dark`, `light`, `solar`, `cyberpunk`, `compact`) — applied via `data-theme` on `<html>` by `ThemeApplier`
- Window opacity (clamped `[0.7, 1.0]`)
- Activity feed (proactive attempts audit log)
- App-improvements queue (Sean's self-improvement proposals)

### Auto-update + relaunch banner
- Daily check via electron-updater. When pending: persistent "Versjon X er klar — Relaunch nå" banner; click → `app:quit-and-install`.

### Local LLM (Ollama) escape hatch
- `ollama:` model prefix routes requests to `localhost:11434` instead of Sean. Persona is fetched once and injected via Ollama's `system` field for cross-model identity. User+assistant rows still persist via `POST /control/sessions/:id/messages`.

---

## 8. Known weaknesses + rough edges

These are real problems an agent will encounter. Not everything is fixed in this session — `feat/foundation` only addresses #1 + sandbox/test scaffolding for the next sessions to use.

1. **TypeScript `messageRoute.ts:156` was failing CI typecheck on every push since v0.4.x.** Fixed in this branch — `Record<string, string>` widened the cast, narrowed to `Record<keyof NonNullable<typeof perAction>, string>` and switched to `perAction?.[…]`. (See first commit on `feat/foundation`.)
2. **Existing tests need a live Postgres on `localhost:5432`.** 39 tests fail with "Can't reach database server" without it. The `embedded-postgres` devDep + `scripts/start-embedded-pg.mjs` is the intended workaround but never wired into the test setup. **Step 4 of the foundation work covers this.**
3. **CI on `main` has been red since v0.4.1.** The `Release control client` workflow (tag-only) keeps shipping installers because it doesn't depend on CI. So the user is publishing new versions on top of red builds — neither blocking nor noticed.
4. **`config.ts.NORDRISE_REPO_URL` default fixed.** Was `https://github.com/BennyK-tech/Nordrise-AI.git` (a dead GitHub account); now `https://github.com/benjaminnk082-lab/nordrise-ai.git`. Override via `NORDRISE_REPO_URL` env var on Railway if you migrate again. The gateway's 30-min `git pull` tick will pick up the new default on the next deploy.
5. **`docs/sean-handoff.md` is from v0.1.11 era and references the dead `BennyK-tech` account throughout**. v1.0.0 milestone framing is also stale; the codebase has shipped routines, proactive engine, self-improvement queue, and three new connectors since. Don't trust its file inventory — use this CLAUDE.md instead.
6. **`README.md` has `REPLACE_ME`-templated repo URLs.** Out of date. Local-dev section is fine; deploy section is misleading.
7. **CI workflow uses `actions/checkout@v4` + `actions/setup-node@v4` (Node 20 actions)**, deprecated as of GitHub's 2025-09-19 announcement. Will be force-upgraded by the runner in June 2026 unless we move to v5.
8. **Permission policy is partly client-side only**. `vaultWrite` is enforced in `apps/control/main/vaultSync.ts` (auto-merger gate). `telegramSend`, `webSearch`, `githubAccess`, `shellExec` are sent to the gateway as a system-prompt fragment but **rely on Sean to follow the instruction** — they are not enforced at the route layer. Real backend enforcement is the v0.5.x roadmap item this branch sets up groundwork for.
9. **No `apps/control/electron-builder.yml` in repo root** despite handoff doc claim — the build config is inline in `apps/control/package.json` `build:` field if present, or implicit defaults. Worth verifying before next release tag.
10. **Codebase auto-pull uses `git pull` from a public repo**. Defensive: `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=/bin/true` + `credential.helper=` are set, but the `exec` call is unbounded other than its 60s `timeout`. A long stall would block one tick but not the gateway.

---

## 9. Local dev loop

### Gateway

```bash
# 1. Embedded Postgres (Windows; replaces Docker)
node scripts/start-embedded-pg.mjs                  # blocks on port 5432

# 2. Apply schema (separate shell)
npm run prisma:migrate:dev                           # uses `prisma migrate dev`
# OR if you don't want a migration:
npx prisma db push

# 3. Run tests
npm test                                              # vitest

# 4. Dev gateway (needs valid Telegram + Claude env)
npm run dev                                           # tsx watch src/gateway.ts

# 5. Talk to Sean directly without HTTP
npm run bridge-repl
```

### Desktop

```bash
cd apps/control
npm install
npm run dev                       # next dev :4001 + electron concurrently
# OR explicit:
npm run dev:renderer              # next dev only
npm run dev:electron              # waits on localhost:4001 then electron .

npm test                          # vitest renderer + main
npm run typecheck                 # all 3 tsconfigs
npm run build && npm start        # packaged-style boot off renderer/out + dist/main
```

### Sandbox (`apps/control-dev/`)

This is the **non-destructive testing mirror** introduced in `feat/foundation` (Step 3). Purpose: experiment with renderer/main changes without putting the live install at risk.

```bash
# from repo root:
npm run dev:sandbox               # boots apps/control-dev with sandbox-only state
```

The sandbox uses:
- A separate Next.js dev port: **`4101`** (not 4001)
- A separate Electron `userData` dir: `<userData>-dev` (so `settings.json`, `data.db`, keychain entries are isolated from the live app)
- A separate backend env override via `NORDRISE_BACKEND_URL` (default: same prod backend; override to a local gateway by setting the var before `npm run dev:sandbox`)
- Built-files are git-ignored under `apps/control-dev/dist/`, `apps/control-dev/.next/`, `apps/control-dev/renderer/out/`, `apps/control-dev/data-dev/`

Do all redesign work in `apps/control-dev/` first. Cherry-pick to `apps/control/` only after Benjamin confirms the change.

---

## 10. Conventions

- **Conventional commits** with scope. Examples: `feat(control): …`, `fix(types): …`, `chore: …`, `docs(claude-md): …`, `test: …`, `refactor: …`.
- Body explains *why*, not *what*.
- Trailer on every commit: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Branches: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`. The current foundation branch is `feat/foundation`.
- Tags:
  - `v<x.y.z>` — gateway only (rare).
  - `control-v<x.y.z>` — desktop client; pushing this triggers `release-control.yml` and publishes a Windows installer.
- PRs are not used by default in this repo. Branches are reviewed locally and merged by Benjamin. Foundation work pushes the branch and waits for review.

---

## 11. When in doubt

- The actual source of truth for the SSE/HTTP shapes is `src/api/control/types.ts`. Run `npm run sync-control-types` after editing.
- The actual source of truth for Sean's persona is `src/prompts/sean.md`. The desktop persona endpoint serves this verbatim.
- The actual source of truth for permission semantics is `apps/control/main/settingsStore.ts` (settings shape) + `src/api/control/messageRoute.ts` (`buildPermissionFragment`).
- For any "is this safe to commit" decision: check §6 against the diff. If it's not in §6 and you're worried, ask Benjamin.

---

## 12. Phase 3 — Capabilities expansion (`feat/openclaw-capabilities`)

This phase brings OpenClaw-style autonomy + Obsidian memory + Anthropic
Skills + cost tracking + git rollback + Lighthouse audits + live website
preview to the desktop client. All work lands in `apps/control-dev/` first,
then is mirrored to `apps/control/` per §9.

### Plumbing summary

**Filesystem** (`<vault>/Sean/` is the new persistent home):

```
<vault>/Sean/
├── HEARTBEAT.md            checklist Sean reads every 30-min tick
├── memories.md             append-only long-term log
├── errors.md               local Sentry-style error log (see §12.5)
├── sessions/<date>-<sid>.md   one note per control session
├── projects/<name>.md      per-project context (e.g. "Tid for Service.md")
├── skills/<skill>/SKILL.md installed skills (frontmatter + body)
├── skills-registry/<skill>/   local-only skill catalogue (manual sync)
└── audits/<date>-<domain>.json   raw Lighthouse JSON dumps
```

**New IPC channels** (registered in `apps/control[-dev]/main/ipc.ts`,
handlers in `apps/control[-dev]/main/<feature>.ts`):

| Channel | Direction | Purpose |
|---|---|---|
| `vault:detect-candidates` | invoke | scan known dirs for `.obsidian/` parents |
| `vault:create` | invoke | bootstrap a fresh vault at a chosen path |
| `vault:read-sean` | invoke | read `<vault>/Sean/<relpath>` |
| `vault:write-sean` | invoke | atomic write to `<vault>/Sean/<relpath>` |
| `vault:list-sean-dir` | invoke | listdir under `Sean/` |
| `skills:list-installed` | invoke | scan `<vault>/Sean/skills/` |
| `skills:list-registry` | invoke | scan `<vault>/Sean/skills-registry/` |
| `skills:install` | invoke | copy registry → installed; user-confirmed |
| `skills:load-into-context` | invoke | resolve a skill body for prompt injection |
| `heartbeat:status` | invoke + broadcast | `{state, lastTickAt, nextTickAt}` |
| `heartbeat:pause` / `:resume` | invoke | toggle daemon |
| `heartbeat:tick-now` | invoke | force a tick (dev/canary use) |
| `costs:summary` | invoke | per-project totals over a window |
| `costs:record` | invoke | called by stream-done handler in renderer |
| `costs:export-csv` | invoke | dump as CSV string |
| `checkpoint:create` | invoke | git-stash or fallback copy |
| `checkpoint:list` | invoke | recent checkpoints with summaries |
| `checkpoint:rollback` | invoke | restore + dequeue |
| `lighthouse:run` | invoke | spawn local Chrome, run audit, dump JSON |
| `preview:start` | invoke | mount Electron BrowserView at a port |
| `preview:resize` / `preview:close` / `preview:reload` | invoke | viewport ops |
| `errors:log` | invoke | append `<vault>/Sean/errors.md` |
| `errors:tail` | invoke | last N entries |

The renderer never bypasses these — same rule as §6.4. Heavy modules
(`lighthouse`, `chrome-launcher`) live in main only; the renderer just
fires invokes and shows results.

**Gateway changes** — to keep the gateway image small (§6.3) the only
gateway change in this phase is the Prisma schema. New models:

```prisma
model Project {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now())
  sessions    ControlSession[] @relation("ProjectSessions")
  tokenUsage  TokenUsage[]
}

model TokenUsage {
  id            String   @id @default(cuid())
  controlSessionId String?
  controlSession   ControlSession? @relation(fields: [controlSessionId], references: [id], onDelete: Cascade)
  projectId        String?
  project          Project?         @relation(fields: [projectId], references: [id], onDelete: SetNull)
  inputTokens   Int      @default(0)
  outputTokens  Int      @default(0)
  costUsd       Float    @default(0)   // informational; subscription is flat
  modelId       String?
  recordedAt    DateTime @default(now())
  @@index([controlSessionId, recordedAt])
  @@index([projectId, recordedAt])
}
```

Plus an optional `projectId String?` on `ControlSession`. All fields are
optional/defaulted (per §6.17) so an older gateway running this schema is
forward-compatible.

New gateway routes (additive, behind `/control/`):

- `GET /control/projects` — list
- `POST /control/projects` — create (`{name, description?}`)
- `PATCH /control/sessions/:id/project` — assign project to thread
- `POST /control/sessions/:id/usage` — record token usage (called by
  desktop after stream completion; gateway persists)
- `GET /control/usage?projectId=&since=` — query for the Costs panel

These are also added to `src/api/control/types.ts` and re-synced to
`apps/control[-dev]/src/server-types.ts` via `npm run sync-control-types`.

### Skill format (Anthropic-compatible)

```markdown
---
name: web-research
description: Browse the web for current information using Firecrawl.
when_to_use: User asks about something current/external/factual.
required_tools: [firecrawl_scrape, firecrawl_search]
files: [research-template.md]
---

# Skill body

Step-by-step instructions Sean reads when this skill is loaded into
context. Front-matter is YAML; body is plain Markdown. Supporting files
referenced under `files:` are made available at the same relative path
when the skill is loaded.
```

### Skill auto-install threat model (§12.4)

A skill body becomes part of Sean's system prompt. A malicious skill can:
- Instruct Sean to read sensitive vault files and exfiltrate via a
  later web tool call.
- Override Sean's persona (the `--append-system-prompt` priority means
  loaded skills are appended **after** the persona, but still before
  user messages).
- Reference attachment files via the skill's `files:` list, baking
  arbitrary text into Sean's context.

Mitigation: every install (whether from the registry or a third-party
share) opens a confirmation modal showing the skill's `name`,
`description`, `required_tools`, source path, and the first 40 lines of
the body. The user must click "Install" to proceed. The skills registry
under `<vault>/Sean/skills-registry/` is local-only — Sean cannot
auto-fetch from the internet. Future remote registries (if any) MUST be
explicitly trusted and signed.

### Self-test harness (`scripts/agent-self-test.mjs`)

Runs from repo root with `npm run agent:self-test`. Two modes:

- `--unit` (default) — imports each feature module and runs synchronous
  pass/fail checks against pure functions. ~1 s. Used as a commit gate.
- `--e2e` — boots the dev app via Playwright, drives canaries through
  the IPC layer, reports per-canary pass/fail. ~30-60 s. Used as a
  release gate.

Canary slots (numbered to match the spec features):

1. Vault path detect + atomic write round-trip
2. SKILL.md parse + frontmatter extract
3. Heartbeat tick produces a non-empty prompt
4. Token usage record/query round-trip
5. Checkpoint create + rollback returns clean tree
6. Lighthouse runner returns scores for `https://example.com`
7. Preview port-detect heuristic recognises 3000/5173/8080
8. Retry helper backs off correctly + errors.md gets a line
9. End-to-end smoke (only meaningful in `--e2e`)

Any failing canary blocks the commit. `--unit` mode skips e2e-only
canaries and prints `SKIP` for them — those are the responsibility of
the release gate.

---

*Generated by Claude Opus 4.7 (1M context) during foundation work on 2026-05-05.
Phase 3 plumbing added 2026-05-05 on `feat/openclaw-capabilities`.
Update freely as architecture evolves; keep §6 conservative.*
