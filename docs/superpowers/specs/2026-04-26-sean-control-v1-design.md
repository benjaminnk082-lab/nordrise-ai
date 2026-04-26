# Sean Control — v1 Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-04-26
**Author:** Benjamin Nicolai Kleiven (with Claude)
**Scope:** v1 of a multi-phase desktop client for the Sean assistant.

---

## 1. Purpose

Build a Windows desktop application — branded **Nordrise Control** and shipped via **Nordrise Installer.exe** — that lets Benjamin operate the Sean assistant from his PC: read its activity history (Telegram + new desktop sessions), send new tasks, and use a small set of "smart" features that make desktop interaction strictly better than the existing Telegram interface for long, file-heavy work.

This document covers **v1 only**. v2 (Obsidian / context picker), v3 (routines / cost panel / notifications), and v4 (voice) are deferred to their own specs.

## 2. Phasing context (for posterity)

The full vision is broken into four phases. v1 is the standalone shell and the features that don't depend on knowledge or scheduling subsystems:

- **v1 — Sean Control:** Electron + installer, live chat, drag&drop file context, quick-tasks, live thinking stream, global hotkeys, healthcheck. *(this spec)*
- **v2 — Sean Knowledge:** Obsidian vault integration, project context picker, in-app memory browser.
- **v3 — Sean Routines:** Recurring tasks with completion tracking, notification rules, cost/usage panel.
- **v4 — Sean Voice:** Local Whisper voice input.

Each phase ships as its own release.

## 3. v1 Goals & non-goals

### Goals
1. Send a message to Sean from Windows and watch the response stream in real-time, including Sean's tool calls (file reads, bash commands).
2. Browse all Sean activity (Telegram and desktop) in one searchable timeline.
3. Maintain a separate "desktop" conversation thread that doesn't pollute the Telegram session.
4. Drag any file (image, PDF, code) into the app and have Sean see it in workspace.
5. Trigger pre-defined "quick tasks" with a global hotkey (`Ctrl+Shift+S`) without context-switching from the active app.
6. Ship as a single signed installer (`Nordrise Installer.exe`) that bootstraps everything end-users need.
7. Preserve the existing Sean-on-Railway invariants: subscription-only auth, single-user whitelist, no API key fallback.

### Non-goals (deferred)
- Obsidian / vault integration (v2)
- Recurring routines and completion tracking (v3)
- Cost/usage tracking with quota math (v3, simple message-count proxy in v1)
- Voice input (v4)
- macOS or Linux builds (Windows-only in v1)
- Multi-user UX (token list supports it; UI does not)

## 4. Architecture

### 4.1 Component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  PC (Windows)                                                   │
│                                                                 │
│   ┌──────────────────────────────┐   ┌──────────────────┐       │
│   │  Electron main process       │   │  Tray icon       │       │
│   │  - lifecycle, IPC, keytar    │◄─►│  - status dot    │       │
│   │  - global hotkeys            │   │  - quick menu    │       │
│   │  - SQLite (quick-tasks)      │   └──────────────────┘       │
│   └──────────────┬───────────────┘                              │
│                  │ IPC                                          │
│   ┌──────────────▼───────────────┐                              │
│   │  Renderer (Next.js + React)  │                              │
│   │  - chat view, timeline       │                              │
│   │  - quick-task palette        │                              │
│   │  - drag&drop file zone       │                              │
│   │  - SSE consumer              │                              │
│   └──────────────┬───────────────┘                              │
│                  │ HTTPS + Bearer                               │
└──────────────────┼──────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  Railway — nordrise-ai gateway (existing service `sean`)         │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  /control routes (NEW)                                  │    │
│   │   POST /control/message      → SSE stream               │    │
│   │   POST /control/upload       → workspace/inbox          │    │
│   │   GET  /control/sessions     → list both kanaler        │    │
│   │   GET  /control/history      → paginert messages        │    │
│   │   POST /control/session/new  → start ny desktop-tråd    │    │
│   └────────────────┬────────────────────────────────────────┘    │
│                    │                                             │
│                    ▼                                             │
│   ┌──────────────────────────────────┐    ┌────────────────┐     │
│   │  ControlSessionManager (NEW)     │───►│ ClaudeBridge   │     │
│   │  - mirrors SessionManager        │    │ (existing)     │     │
│   │  - separate ControlSession table │    └────────┬───────┘     │
│   └──────────────────────────────────┘             │             │
│                    │                                ▼             │
│                    └────────►  Postgres (Session, ControlSession, │
│                                Message — sessionId XOR            │
│                                controlSessionId)                  │
│                                                                   │
│   workspace/inbox/  ← uploads from desktop                        │
│   workspace/memory/ ← Sean's existing notes                       │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Key components

| Component | Location | Purpose |
|---|---|---|
| Electron main | `apps/control/main/` | Lifecycle, IPC, global hotkeys, keytar, local SQLite, deep-link handling, tray |
| Preload | `apps/control/preload/` | Bridges main↔renderer via `contextBridge`. `contextIsolation: true` and `nodeIntegration: false` are mandatory; only the preload may expose IPC. |
| Renderer | `apps/control/renderer/` | Next.js (static export), React UI |
| Installer | `apps/installer/` | electron-builder + NSIS config, Nordrise branding |
| Control API | `src/api/control/` | Express routes mounted on existing gateway |
| ControlSessionManager | `src/controlSessionManager.ts` | Mirrors `SessionManager` but for desktop sessions |

`apps/control/` is a **sibling project** in the same git repo, not an npm workspace. It has its own `package.json` and `package-lock.json` independent from the server's. This keeps the existing Dockerfile (`npm ci` against root `package-lock.json`) completely unchanged. Shared types (SSE events, API contracts) are maintained in a single `src/api/control/types.ts` file on the server and **copied into** `apps/control/src/server-types.ts` by a tiny build script (`scripts/sync-control-types.ts`) run in CI and pre-commit. Drift is caught by tsc on the client side. This is duct-tape but cheap, removes any risk to backend deploys, and is straightforward to upgrade to a real shared package later.

The existing `ClaudeBridge` is **reused unchanged**. The `gateway.ts` file mounts a new `/control` router but otherwise stays as-is. The Dockerfile, entrypoint, and `verify-auth` boot gate are not modified, preserving the subscription-only invariant.

### 4.3 Repo structure

```
nordrise-ai/
├── apps/
│   ├── control/                    Electron + Next.js, sibling project (own package.json + lockfile)
│   │   ├── main/
│   │   │   ├── index.ts            lifecycle, IPC, hotkeys
│   │   │   ├── tray.ts             tray-ikon + menu
│   │   │   ├── keychain.ts         keytar wrapper
│   │   │   ├── store.ts            better-sqlite3 (quick-tasks)
│   │   │   └── ipc.ts              IPC-handlers
│   │   ├── preload/
│   │   │   └── index.ts            contextBridge: api.invoke, api.on
│   │   ├── renderer/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx        chat (main view)
│   │   │   │   ├── timeline/page.tsx
│   │   │   │   ├── quick-tasks/page.tsx
│   │   │   │   └── onboarding/page.tsx
│   │   │   ├── components/         ChatView, ThinkingPanel, ThreadList,
│   │   │   │                       Composer, DropZone, QuickTaskPalette,
│   │   │   │                       StatusBar
│   │   │   ├── hooks/              useSSE, useThreads, useQuickTasks
│   │   │   └── lib/api.ts          typed client mot /control/*
│   │   ├── src/server-types.ts     copied from src/api/control/types.ts in CI
│   │   ├── package.json            standalone (no workspace ref)
│   │   ├── package-lock.json       independent
│   │   ├── electron-builder.yml
│   │   └── next.config.mjs
│   └── installer/
│       ├── nordrise-installer.nsh
│       ├── assets/                 logo.ico, banner.bmp, splash.png
│       └── README.md
├── src/                            existing backend, untouched layout
│   ├── api/
│   │   └── control/                NEW
│   │       ├── routes.ts
│   │       ├── auth.ts
│   │       ├── upload.ts
│   │       ├── stream.ts           SSE-helpers
│   │       ├── history.ts          Telegram read-only
│   │       ├── inboxCleanup.ts     setInterval-based, runs in gateway
│   │       └── types.ts            authoritative SSE & API types
│   ├── controlSessionManager.ts    NEW
│   ├── claudeBridge.ts             reused
│   ├── sessionManager.ts           reused
│   └── gateway.ts                  mounts /control router, starts inboxCleanup
├── prisma/
│   └── schema.prisma               + ControlSession, + Message relation
├── scripts/
│   ├── sync-control-types.ts       NEW: cp src/api/control/types.ts → apps/control/src/server-types.ts
│   └── (existing scripts)
├── docs/superpowers/specs/
├── package.json                    unchanged at root (server only)
└── package-lock.json               unchanged
```

The backend repo root stays exactly as today — same `package.json`, same `package-lock.json`, same `Dockerfile`. `apps/control` is a separate npm project living in the same git tree. CI runs server tests and client tests in two separate jobs.

### 4.4 Schema changes

```prisma
model ControlSession {
  id              String    @id @default(cuid())
  title           String?   // user-editable, default "Ny tråd YYYY-MM-DD"
  claudeSessionId String?
  createdAt       DateTime  @default(now())
  lastActiveAt    DateTime  @updatedAt
  archivedAt      DateTime?
  messages        Message[]

  @@index([lastActiveAt])
  @@index([archivedAt])
}

model Message {
  id                String           @id @default(cuid())
  sessionId         String?
  controlSessionId  String?
  session           Session?         @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  controlSession    ControlSession?  @relation(fields: [controlSessionId], references: [id], onDelete: Cascade)
  role              String
  content           String           @db.Text
  tokens            Int?
  durationMs        Int?
  createdAt         DateTime         @default(now())

  @@index([sessionId, createdAt])
  @@index([controlSessionId, createdAt])
  // Application-level invariant: exactly one of sessionId / controlSessionId is non-null.
  // Enforced in code, not DB constraint, since Postgres CHECK across two FK columns is awkward in Prisma.
}
```

The migration involves two changes:

1. **Additive:** create `ControlSession` table; add `controlSessionId` column to `Message` (nullable, FK to `ControlSession.id`).
2. **Constraint relaxation:** change `Message.sessionId` from required to nullable. This is a non-additive schema change — existing rows are unaffected (they keep their non-null `sessionId`), but the column itself becomes nullable.

Backfill is unnecessary (existing Telegram rows keep `sessionId`, new desktop rows will have `controlSessionId`). Migration is tested locally first; Postgres backup taken before first deploy.

## 5. Data flow

### 5.1 Send a message (with attachment)

1. User types "fiks deploy" and drops `screenshot.png` in the drop zone.
2. Renderer issues `POST /control/upload` (multipart, single file). Backend writes to `/app/workspace/inbox/<cuid>-screenshot.png` and returns `{ fileId, workspacePath }`.
3. Renderer issues `POST /control/message`:
   ```json
   {
     "controlSessionId": "ck...",
     "text": "fiks deploy",
     "attachments": [{ "fileId": "...", "workspacePath": "/app/workspace/inbox/<cuid>-screenshot.png" }]
   }
   ```
   Response is `text/event-stream` (SSE), held open.
4. Backend handler:
   1. Validates Bearer token.
   2. `controlSessionManager.getOrCreate(controlSessionId)` (creates if null).
   3. Persists user message to DB.
   4. Builds final prompt: `"fiks deploy\n\n[Vedlegg tilgjengelig: /app/workspace/inbox/<cuid>-screenshot.png]"`.
   5. Calls `claudeBridge.invoke({ message, sessionId: claudeSessionId })`.
   6. Subscribes to bridge events and translates each to an SSE frame on the open response.
5. Renderer receives SSE events, accumulates partials, renders tool calls in the right-hand thinking panel.
6. On bridge resolve, backend persists assistant message and emits `event: done`. SSE closes.

### 5.2 SSE event protocol

```
event: thinking
data: {"at": 1714128000000}

event: session
data: {"claudeSessionId": "<uuid>", "controlSessionId": "<cuid>"}

event: partial
data: {"text": "Sjekker Railway"}

event: tool
data: {"name": "Bash", "input": "git status", "status": "running"}

event: tool
data: {"name": "Bash", "status": "done", "output": "On branch main\n..."}

event: done
data: {"durationMs": 4231, "costUsdInformational": 0.0042, "isError": false}

event: error
data: {"message": "rate_limit", "retryAfterMs": 18000}
```

Heartbeat (`event: heartbeat\ndata: {}`) every 25s to keep Railway proxy from closing idle SSE connections.

### 5.3 Abort

Renderer aborts via `AbortController` on the fetch. Backend listens for `req.on('close')` and signals the bridge via `AbortSignal`, which sends SIGTERM to the `claude` subprocess. The user sees a stop button while a stream is active.

### 5.4 Timeout

Backend respects existing `CLAUDE_CALL_TIMEOUT_MS` (120s). On timeout, an `error` SSE frame with `{"message": "timeout"}` is sent and the stream closes.

### 5.5 Resume after disconnect

If the SSE connection drops mid-response, backend continues to completion and persists the assistant message. Renderer reconnects and calls `GET /control/sessions/:id/messages?since=<lastSeenAt>` to fetch any messages missed.

### 5.6 Telegram history (read-only)

`GET /control/history?source=telegram&limit=100&before=<cursor>` paginates over Telegram sessions. UI shows them in the same timeline as desktop messages, marked with a Telegram badge. Click → "Continue this thread in a new desktop session" copies the `claudeSessionId` and opens a new `ControlSession` resuming the same Claude thread.

## 6. UI

### 6.1 Main window (1200×800, resizable, dark theme)

```
┌──────────────────────────────────────────────────────────────────────┐
│ ●●●  Nordrise Control                                  ●  Sean: green│
├──────────┬─────────────────────────────────────────┬─────────────────┤
│ THREADS  │                                         │  THINKING       │
│          │   ─── 14:22 (Telegram) ────────────────│                 │
│ + Ny     │   You: Sjekk Railway-deploy             │  ▾ Bash         │
│          │                                         │    git status   │
│ ▼ Desktop│   ─── 14:22 (Telegram) ────────────────│    → On main…   │
│ ● Deploy │   Sean: Deployen feilet på prisma…     │                 │
│   debug  │                                         │  ▾ Read         │
│   12:14  │   ─── 14:31 (Desktop) ─────────────────│    Dockerfile   │
│   Happy  │   You: 📎 screenshot.png                │                 │
│   Time   │        fiks deploy                      │  ⏱ 3.2s         │
│   POS    │                                         │                 │
│   09:45  │   Sean (typing…)                        │                 │
│          │   ▌Sjekker Railway-loggene først        │                 │
│ ▼ Telegr │                                         │                 │
│   …      │                                         │                 │
│          ├─────────────────────────────────────────┤                 │
│          │ [📎] [✨ Quick] Skriv en task...   [↑] │                 │
│          └─────────────────────────────────────────┴─────────────────┤
│ Msgs siste 5h: 12 · Reset 16:50 · Token OK                            │
└──────────────────────────────────────────────────────────────────────┘
```

- **Left rail:** thread list, grouped Desktop / Telegram (read-only). New thread via `+ Ny`. Right-click: archive/rename. Drag-reorder.
- **Center:** chat view with role bubbles, code blocks (Shiki highlight), copy button per code block and per message. Center pane becomes the drop zone when a file is dragged over the window. Composer at bottom with attachment chips.
- **Right panel:** "Thinking" — collapsible, shows tool calls live from SSE `tool` events. Collapsed by default for non-tool conversations.
- **Status bar:** message count over the rolling 5h window (computed client-side from cached message timestamps), reset clock, auth status. Real quota math (token-aware) is v3; v1 displays an explicit "Msgs siste 5h" label so the number can't be misread as a percentage.

### 6.2 Mini-popup (Ctrl+Shift+S, 600×140, always-on-top)

```
┌────────────────────────────────────────┐
│ ⚡ Sean                            [×] │
├────────────────────────────────────────┤
│ [📎]  Skriv en quick task…       [↑]  │
└────────────────────────────────────────┘
```

Sends to the active desktop thread (or last active if none open). Closes after submit. Result delivered as a native Windows toast with "Open answer" — focuses main window on the new message.

### 6.3 Tray icon

- Status: green (healthy) / yellow (rate-limit near) / red (auth fail or healthz down). Polled `/healthz` every 30s.
- Right-click menu:
  - Open (Ctrl+Shift+L)
  - Quick task… (Ctrl+Shift+S)
  - Quick-tasks: { top 5 by recency }
  - Pause notifications
  - Quit

### 6.4 Quick-task palette (Ctrl+K or "✨ Quick" button)

```
┌──────────────────────────────────────────────────┐
│ 🔍 Søk eller velg quick-task…                    │
├──────────────────────────────────────────────────┤
│ 📊 Skriv ukerapport for Happy Time               │
│ 🚀 Sjekk Railway deploy-status                   │
│ 📝 Lag Notion-side fra utklippstavlen            │
│ 🐛 Debug siste git-commit                        │
│ ─────                                            │
│ + Ny quick-task                                  │
└──────────────────────────────────────────────────┘
```

Quick-task data model:

```ts
type QuickTask = {
  id: string;
  title: string;
  emoji: string;
  template: string;            // with {{var}} placeholders
  variables: Variable[];       // [{ name, prompt, default? }]
  attachClipboard: boolean;
  hotkey?: string;             // e.g. "Ctrl+Shift+1"
  createdAt: number;
  updatedAt: number;
};
```

Stored in local SQLite (`%APPDATA%/nordrise-control/data.db`). Variables are prompted before the message is sent. CRUD via `/quick-tasks` route in the renderer.

### 6.5 Drag & drop file context

1. User drags file over main window. Center area dims, shows "📥 Slipp her for å legge ved".
2. Drop → file POSTed to `/control/upload`, returns `workspacePath`.
3. Composer shows attachment chip with × to remove.
4. On send, backend prepends `[Vedlegg tilgjengelig: /app/workspace/inbox/<cuid>-<filename>]` to the prompt.
5. Sean reads the file via its `Read` tool from `/app/workspace/inbox/`.
6. Inbox auto-cleanup runs as a `setInterval` inside the existing gateway process (every hour, deletes anything in `/app/workspace/inbox/` older than 7 days). This is intentionally simple — the v3 routine/cron subsystem is *not* a prerequisite. Cleanup also runs once at gateway boot.

### 6.6 Global hotkeys

| Key | Action |
|---|---|
| `Ctrl+Shift+S` | Open mini-popup |
| `Ctrl+Shift+L` | Focus main window, last thread |
| `Ctrl+Shift+1..5` | Trigger quick-tasks #1–5 |
| `Ctrl+K` (in main) | Quick-task palette |
| `Ctrl+N` (in main) | New thread |
| `Esc` | Close popup / abort streaming |

Registered via Electron `globalShortcut` in main process.

## 7. Auth & security

### 7.1 Token model

Token issuance is a one-time manual flow:

1. User runs `npm run control:issue-token` locally. The script prints a 32-byte hex string to stdout. Nothing else happens — the script does not call Railway.
2. User appends the token to the Railway env var `CONTROL_API_TOKENS` (comma-separated list — supports multi-device later without revoking everything):
   ```
   railway variables --set CONTROL_API_TOKENS="<existing>,<new-token>"
   ```
   Railway redeploys the `sean` service; new token is live within ~30s.
3. User pastes the same token into the Electron app's onboarding screen.
4. App stores it via `keytar` in Windows Credential Manager (service: `nordrise-control`, account: `bearer`). Fallback: Electron `safeStorage` (DPAPI on Windows) if `keytar` build fails on a future Electron major.

All `/control/*` requests then carry `Authorization: Bearer <token>`.

### 7.2 Backend validation

```ts
const ALLOWED_TOKENS = new Set(
  config.CONTROL_API_TOKENS.split(',').map(t => t.trim()).filter(Boolean)
);

export function requireControlToken(req, res, next) {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !ALLOWED_TOKENS.has(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
```

Token comparison uses `timingSafeEqual` against each allowed token (entropy makes this academic, but it's trivial to add).

### 7.3 Threats and mitigations

| Threat | Mitigation |
|---|---|
| Token leak via logs | Pino redact rules for `Authorization` header |
| File upload abuse | `multer` with `limits.fileSize: 25MB`, `limits.files: 5`. Filename sanitized via `[^a-zA-Z0-9._-]` → `_`. Magic-byte check via `file-type` rejects executables. 7-day inbox cleanup. |
| Path traversal | Files always written to `/app/workspace/inbox/<cuid>-<sanitized-name>` — cuid prefix makes path predictable and unique. |
| SSE leak / orphaned subprocess | `req.on('close')` triggers `bridge.abort()`. Heartbeat keeps Railway proxy alive. |
| CORS | Lock to `nordrise-control://` custom Electron protocol; backend whitelists that origin. |
| CSRF | N/A — bearer token auth, not cookies. |
| MITM | Railway TLS only. |
| Token revocation | Remove from `CONTROL_API_TOKENS` and redeploy. |

### 7.4 Auth invariant

The `verify-auth` boot gate, sanitized `ANTHROPIC_API_KEY`, and `CLAUDE_CODE_OAUTH_TOKEN` subscription mode are **untouched**. `/control` routes go through the same `ClaudeBridge` and `sanitizedEnv()` path.

## 8. Error handling

| Failure | Response | Client behavior |
|---|---|---|
| Auth fail | `401` JSON | Show onboarding, prompt for new token |
| Rate-limit (Max) | SSE `error` `{type:"rate_limit", retryAfterMs}` | Banner: "Sean er sliten — prøv igjen om N sek". Disable composer for N sec. |
| `claude -p` timeout | SSE `error` `{type:"timeout"}` | Toast + message marked failed. Retry button. |
| Subprocess crash | SSE `error` `{type:"bridge_error", message}` | Toast "Sean kræsjet" + expandable detail. Pino-log on server. |
| Upload too large | `413` JSON | Inline error in drop zone |
| Postgres down | `503` from `/healthz` | Status bar red. Healthz polled every 5s for recovery. |

Client-side:
- SSE auto-reconnect with exponential backoff (1s, 2s, 4s, max 10s). After 5 failures: offline banner.
- 401 → wipe keytar, route to onboarding.
- Crash: Electron `crashReporter` to local file only (no external telemetry).

## 9. Logging

**Server (pino):**
- `control.message.start` — controlSessionId, hasAttachments
- `control.message.done` — durationMs, isError
- `control.upload` — size, mimeType
- `control.auth.fail` — ip, reason (no token value logged)

**Client:**
- Local rotating log in `%APPDATA%/nordrise-control/logs/`, 7-day retention.
- No external telemetry.

## 10. Testing

### 10.1 Backend

| Layer | Type | Tools | What |
|---|---|---|---|
| Routes | Integration | vitest + supertest + Prisma test schema | Auth, validation, upload limits, SSE event ordering |
| ControlSessionManager | Unit | vitest + Prisma test DB | getOrCreate, rotation |
| ClaudeBridge integration | Mocked | Replace `spawn` with NDJSON fixture stream | SSE frames match bridge events 1:1 |

Critical cases:
- Missing/invalid token → 401, log entry written
- Client closes stream → `bridge.abort()` called, no orphaned subprocess
- Stream timeout → SSE `error` sent, clean disconnect
- 26MB upload → 413
- `.exe` upload (magic-byte check) → 415
- `controlSessionId` belonging to a Telegram session → 404 (cross-channel leak blocked)
- Rate-limit detected in bridge → propagated as SSE `error` with `retryAfterMs`

### 10.2 Client

| Layer | Type | Tools | What |
|---|---|---|---|
| React components | Unit | vitest + Testing Library + jsdom | Chat rendering, drag&drop, palette |
| SSE hook | Unit | vitest + mock EventSource | Reconnect, abort, partial accumulation |
| Keytar/IPC | Unit | vitest + mocked keytar/ipc | Token roundtrip, log redaction |
| Quick-task SQLite | Unit | vitest + in-memory better-sqlite3 | CRUD, variable substitution |
| Hotkeys smoke | Manual / Playwright Electron | playwright | Ctrl+Shift+S opens mini-popup |

### 10.3 E2E

One happy path: spin up local Postgres + backend with test token, package Electron, run Playwright:
1. Onboarding accepts test token.
2. Click "+ Ny tråd".
3. Send "hei".
4. Wait for SSE `done`.
5. Verify message in timeline and DB.

Just smoke detection, not a full suite.

### 10.4 CI

- Existing GitHub Actions backend job runs as before.
- New `client` job: `cd apps/control && npm ci && npm test && npm run build` (Next.js static export + electron-builder `--dir` dry-run, no installer).
- `.exe` packaging only on tagged release (`v*`) → uploads to GitHub Releases.
- Pre-commit hook runs `scripts/sync-control-types.ts` so `apps/control/src/server-types.ts` stays in lockstep with `src/api/control/types.ts`.

## 11. Milestones (estimate ~3 weeks)

| Week | Milestone | Acceptance |
|---|---|---|
| 1 | M1 — Backend skeleton + auth + minimal SSE | `/control/message` accepts bearer, creates ControlSession, calls bridge, streams partials. `/control/sessions`, `/control/history` work. Vitest green. Deployed to Railway. |
| 1.5 | M2 — Electron + Next.js bootstrap, onboarding | App launches, onboarding accepts token, stores in keytar. Healthz button. Empty main window with Nordrise theme + tray icon. |
| 2 | M3 — Chat + streaming + thread list | Renderer connects SSE, streams partials live, persists threads. Telegram history read-only in left rail. Composer + send works. |
| 2.5 | M4 — Drag&drop + quick-tasks + hotkeys | File drop → upload → attached message. Quick-task palette with SQLite + variable prompts. Global hotkeys + mini-popup work. |
| 3 | M5 — Installer + signing + release | electron-builder packages `.exe`. NSIS wrapper with Nordrise branding. Auto-update via electron-updater → GitHub Releases. Smoke-test on fresh Windows VM. |
| 3+ | M6 — Polish & ship | E2E green. README + install guide. Tag `v0.1.0`. Upload installer. |

Each milestone is its own PR with review checkpoint.

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SmartScreen blocks unsigned installer | High | Friction at install ("More info → Run anyway") | Accepted in v1. Plan: EV code-signing cert before v2 if shared with Martin. |
| Railway proxy times out SSE after 100s | Medium | Long tasks appear dead | 25s heartbeat. Bridge timeout=120s aligned. |
| `keytar` build fails in Electron | Low | Onboarding crash | Fallback to Electron `safeStorage` (DPAPI). |
| Prisma migration on prod fails | Low | Sean down on deploy | Migration tested locally. Postgres backup before first deploy. `prisma migrate deploy` runs in entrypoint. |
| Single-user assumption breaks | Medium | Token UX gets messy | `CONTROL_API_TOKENS` is already a list — multi-device is just "issue and append". |
| Quota estimate is wrong | Low | Confusing UI | v1 shows just message count + reset time. Real math in v3. |
| OAuth token expiry (~1 year) | Eventual | Sean down | Boot gate already catches. Add desktop banner when healthz reports auth fail. |

## 13. YAGNI cuts (explicit non-features in v1)

- Multi-user / multi-device UI for token issuing
- macOS / Linux Electron build
- Theme switching (dark only)
- Mobile companion / responsive layout
- In-app onboarding videos
- Visual customization of quick-tasks (icons, colors beyond emoji)
- Markdown editor for outgoing messages (rendering yes, editing no)
- Conversational branching (linear threads only)
- Conflict resolution for concurrent sessions across devices

## 14. Open follow-ups for later phases

- v2: Obsidian Git plugin sync between user vault and `/app/workspace/memory/`. Project context picker draws from vault notes + git/Notion/Railway integrations.
- v3: `Routine` and `RoutineRun` Prisma models. Railway cron triggers routine runs. UI shows completion status. Notification rules per thread and per routine.
- v4: Local Whisper or Groq Whisper API for voice input. Push-to-talk hotkey.
