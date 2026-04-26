# Sean Control v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows desktop client (Nordrise Control, distributed as `Nordrise Installer.exe`) that lets Benjamin operate the Sean assistant from his PC — chat in real-time, browse Telegram + desktop history in one timeline, drag&drop file context, and trigger quick-tasks via global hotkeys.

**Architecture:** Backend extends the existing `nordrise-ai` gateway on Railway with `/control/*` routes (token-auth, SSE streaming) and a new `ControlSession` Prisma model. Client is Electron + Next.js (static export) as a sibling project under `apps/control/`. No npm workspaces — backend Dockerfile stays untouched.

**Tech Stack:** Backend: Express, Prisma, Postgres, pino, vitest (NEW). Client: Electron 28+, Next.js 14, React 18, Tailwind, shadcn/ui, better-sqlite3, keytar, electron-builder + NSIS, vitest. Shared: TypeScript strict, ESM, conventional commits.

**Spec reference:** `docs/superpowers/specs/2026-04-26-sean-control-v1-design.md`

**Working agreement:** Each task ends in a commit. PR per milestone. Conventional commits with scope (`feat(control-api):`, `feat(electron):`, etc.). Norwegian-friendly commit bodies OK.

---

## Pre-flight: existing repo state (read once before starting)

| Fact | Value |
|---|---|
| Repo root | `C:\Users\benja\nordrise-ai` (no GitHub remote yet — push to GitHub when convenient) |
| Module system | ESM (`"type": "module"`), NodeNext resolution |
| Test runner | None today. Vitest added in Task 1. |
| Config validation | `src/config.ts` uses zod + boots refuse if `ANTHROPIC_API_KEY` set |
| Logger redact | `src/logger.ts` already redacts `req.headers.authorization` — no change needed |
| Existing Prisma | Session, Message, MemoryNote in `prisma/schema.prisma` |
| Dockerfile | Uses `npm ci`. Must NOT change in v1. |
| CI | `.github/workflows/ci.yml`: typecheck + build + docker. We'll extend it. |

---

# Milestone M1 — Backend foundation (Tasks 1-11)

Goal: Sean's gateway gains `/control/*` routes that pass auth, persist to a new `ControlSession` table, stream `claude -p` output as SSE, accept file uploads, and clean up its inbox. Deployed to Railway. All vitest tests green.

---

### Task 1: Add vitest + first smoke test

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\package.json`
- Create: `C:\Users\benja\nordrise-ai\vitest.config.ts`
- Create: `C:\Users\benja\nordrise-ai\src\smoke.test.ts`
- Modify: `C:\Users\benja\nordrise-ai\.github\workflows\ci.yml`

- [ ] **Step 1: Install vitest + supertest devDeps**

```bash
cd /c/Users/benja/nordrise-ai
npm install --save-dev vitest@2.1.8 @vitest/coverage-v8@2.1.8 supertest@7.0.0 @types/supertest@6.0.2
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 3: Add `src/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('node version is >= 20', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
```

- [ ] **Step 4: Add `test` script to `package.json`**

In `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Run it, verify green**

```bash
npm test
```
Expected: 1 test passed.

- [ ] **Step 6: Update `.github/workflows/ci.yml` to run tests**

After the `Build` step in the `build` job, append:
```yaml
      - name: Test
        run: npm test
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/smoke.test.ts .github/workflows/ci.yml
git commit -m "chore(test): add vitest with smoke test"
```

---

### Task 2: Add `CONTROL_API_TOKENS` config + token-issue script

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\src\config.ts`
- Modify: `C:\Users\benja\nordrise-ai\.env.example`
- Create: `C:\Users\benja\nordrise-ai\scripts\issue-control-token.ts`
- Modify: `C:\Users\benja\nordrise-ai\package.json`
- Create: `C:\Users\benja\nordrise-ai\src\config.test.ts`

- [ ] **Step 1: Write failing test for parsing CONTROL_API_TOKENS**

`src/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseControlTokens } from './config.js';

describe('parseControlTokens', () => {
  it('returns empty array for undefined', () => {
    expect(parseControlTokens(undefined)).toEqual([]);
  });
  it('returns empty array for empty string', () => {
    expect(parseControlTokens('')).toEqual([]);
  });
  it('parses single token', () => {
    expect(parseControlTokens('abc123')).toEqual(['abc123']);
  });
  it('parses multiple comma-separated tokens trimmed', () => {
    expect(parseControlTokens('a , b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('drops empty entries', () => {
    expect(parseControlTokens(',a,, ,b,')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- src/config.test.ts
```
Expected: FAIL — `parseControlTokens` not exported.

- [ ] **Step 3: Add export + zod field to `src/config.ts`**

Inside the zod schema, before `WORKSPACE_DIR`:
```ts
  CONTROL_API_TOKENS: z.string().default(''),
```

At end of file (after `export const config`):
```ts
export function parseControlTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export const controlTokens = parseControlTokens(config.CONTROL_API_TOKENS);
```

- [ ] **Step 4: Run, verify PASS**

```bash
npm test -- src/config.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Add `CONTROL_API_TOKENS` to `.env.example`**

Append after `LOG_LEVEL`:
```
# -----------------------------------------------------------------------------
# Control API (desktop client)
# -----------------------------------------------------------------------------
# Comma-separated bearer tokens that are allowed to call /control/*.
# Generate with: npm run issue-control-token
# Then append to this var in Railway:
#   railway variables --set CONTROL_API_TOKENS="<existing>,<new>"
CONTROL_API_TOKENS=
```

- [ ] **Step 6: Create token-issue script**

`scripts/issue-control-token.ts`:
```ts
import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('hex');
process.stdout.write(`\nNew control API token (32 bytes hex):\n\n  ${token}\n\n`);
process.stdout.write('Add it to Railway:\n');
process.stdout.write(`  railway variables --set CONTROL_API_TOKENS="<existing>,${token}"\n\n`);
process.stdout.write('Then paste it into the desktop app onboarding screen.\n');
```

- [ ] **Step 7: Add npm script**

In `package.json` `"scripts"`:
```json
"issue-control-token": "tsx scripts/issue-control-token.ts"
```

- [ ] **Step 8: Run it once to verify**

```bash
npm run issue-control-token
```
Expected: prints a 64-char hex token plus instructions.

- [ ] **Step 9: Commit**

```bash
git add src/config.ts src/config.test.ts .env.example scripts/issue-control-token.ts package.json
git commit -m "feat(control-api): add CONTROL_API_TOKENS env + issue-token script"
```

---

### Task 3: Auth middleware

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\auth.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\auth.test.ts`

- [ ] **Step 1: Write failing tests**

`src/api/control/auth.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { makeRequireControlToken } from './auth.js';

function mockReq(authHeader?: string): Request {
  return { header: (n: string) => (n.toLowerCase() === 'authorization' ? authHeader : undefined), ip: '127.0.0.1' } as unknown as Request;
}
function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res as Response);
  res.json = vi.fn().mockReturnValue(res as Response);
  return res as Response;
}

describe('requireControlToken', () => {
  it('rejects missing Authorization header', () => {
    const mw = makeRequireControlToken(['t1']);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects header without Bearer prefix', () => {
    const mw = makeRequireControlToken(['t1']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('t1'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects unknown token', () => {
    const mw = makeRequireControlToken(['t1']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer wrong'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects when allowlist is empty', () => {
    const mw = makeRequireControlToken([]);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer anything'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('accepts a known token', () => {
    const mw = makeRequireControlToken(['t1', 't2']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer t2'), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- src/api/control/auth.test.ts
```
Expected: cannot resolve `./auth.js`.

- [ ] **Step 3: Implement middleware**

`src/api/control/auth.ts`:
```ts
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../logger.js';

export type ControlTokenMiddleware = (req: Request, res: Response, next: NextFunction) => void;

function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function makeRequireControlToken(allowed: readonly string[]): ControlTokenMiddleware {
  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      logger.warn({ ip: req.ip, reason: 'no_bearer' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0 || allowed.length === 0) {
      logger.warn({ ip: req.ip, reason: 'empty_token_or_allowlist' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const ok = allowed.some((t) => safeEq(token, t));
    if (!ok) {
      logger.warn({ ip: req.ip, reason: 'unknown_token' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npm test -- src/api/control/auth.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/control/auth.ts src/api/control/auth.test.ts
git commit -m "feat(control-api): bearer-token auth middleware with timing-safe compare"
```

---

### Task 4: Prisma migration — ControlSession + Message.sessionId nullable

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\prisma\schema.prisma`
- Will create: `prisma/migrations/<timestamp>_add_control_session/migration.sql` (auto)

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Replace the existing `Message` model and add `ControlSession`:

```prisma
model ControlSession {
  id              String    @id @default(cuid())
  title           String?
  claudeSessionId String?
  createdAt       DateTime  @default(now())
  lastActiveAt    DateTime  @updatedAt
  archivedAt      DateTime?
  messages        Message[]

  @@index([lastActiveAt])
  @@index([archivedAt])
}

model Message {
  id               String          @id @default(cuid())
  sessionId        String?
  controlSessionId String?
  session          Session?        @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  controlSession   ControlSession? @relation(fields: [controlSessionId], references: [id], onDelete: Cascade)
  role             String
  content          String          @db.Text
  tokens           Int?
  durationMs       Int?
  createdAt        DateTime        @default(now())

  @@index([sessionId, createdAt])
  @@index([controlSessionId, createdAt])
}
```

- [ ] **Step 2: Generate migration locally against a dev Postgres**

If you don't have a local Postgres, run one quickly:
```bash
docker run --rm -d --name nordrise-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
npx prisma migrate dev --name add_control_session
```
Expected: creates `prisma/migrations/<timestamp>_add_control_session/migration.sql` and applies it.

- [ ] **Step 3: Inspect the migration**

Open the generated `migration.sql` and verify it contains:
- `CREATE TABLE "ControlSession"`
- `ALTER TABLE "Message" ALTER COLUMN "sessionId" DROP NOT NULL`
- `ALTER TABLE "Message" ADD COLUMN "controlSessionId" TEXT`
- Two new indexes

If the existing schema had no migrations directory, Prisma will baseline. In that case the entrypoint runs `prisma db push` which reconciles. Confirm the schema is in sync via:
```bash
npx prisma migrate status
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 5: Type-check still passes**

```bash
npm run typecheck
```
Expected: no errors. (No code references the new model yet.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add ControlSession + nullable Message.sessionId"
```

---

### Task 5: ControlSessionManager

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\controlSessionManager.ts`
- Create: `C:\Users\benja\nordrise-ai\src\controlSessionManager.test.ts`

- [ ] **Step 1: Write failing tests**

`src/controlSessionManager.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ControlSessionManager } from './controlSessionManager.js';

const prisma = new PrismaClient();
const mgr = new ControlSessionManager(prisma);

beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ControlSessionManager', () => {
  it('creates a new session when id is null', async () => {
    const s = await mgr.getOrCreate(null);
    expect(s.isNew).toBe(true);
    expect(s.claudeSessionId).toBeNull();
    expect(typeof s.id).toBe('string');
  });
  it('returns existing session when id is given', async () => {
    const a = await mgr.getOrCreate(null);
    const b = await mgr.getOrCreate(a.id);
    expect(b.id).toBe(a.id);
    expect(b.isNew).toBe(false);
  });
  it('throws if id is given but does not exist', async () => {
    await expect(mgr.getOrCreate('does-not-exist')).rejects.toThrow();
  });
  it('records a user message under the session', async () => {
    const s = await mgr.getOrCreate(null);
    await mgr.recordMessage({ controlSessionId: s.id, role: 'user', content: 'hei' });
    const messages = await prisma.message.findMany({ where: { controlSessionId: s.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.sessionId).toBeNull();
  });
  it('updates claudeSessionId and bumps lastActiveAt', async () => {
    const s = await mgr.getOrCreate(null);
    const before = (await prisma.controlSession.findUnique({ where: { id: s.id } }))!.lastActiveAt;
    await new Promise((r) => setTimeout(r, 5));
    await mgr.updateClaudeSessionId(s.id, 'claude-uuid-1');
    const row = await prisma.controlSession.findUnique({ where: { id: s.id } });
    expect(row?.claudeSessionId).toBe('claude-uuid-1');
    expect(row!.lastActiveAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- src/controlSessionManager.test.ts
```
Expected: cannot resolve module.

- [ ] **Step 3: Implement**

`src/controlSessionManager.ts`:
```ts
import type { PrismaClient, ControlSession } from '@prisma/client';
import { logger } from './logger.js';

export interface ResolvedControlSession {
  id: string;
  claudeSessionId: string | null;
  isNew: boolean;
}

export class ControlSessionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(id: string | null): Promise<ResolvedControlSession> {
    if (id === null) {
      const today = new Date().toISOString().slice(0, 10);
      const row = await this.prisma.controlSession.create({
        data: { title: `Ny tråd ${today}` },
      });
      logger.info({ controlSessionId: row.id }, 'control session created');
      return { id: row.id, claudeSessionId: null, isNew: true };
    }
    const row = await this.prisma.controlSession.findUnique({ where: { id } });
    if (!row) throw new Error(`control session not found: ${id}`);
    return { id: row.id, claudeSessionId: row.claudeSessionId, isNew: false };
  }

  async updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void> {
    await this.prisma.controlSession.update({
      where: { id },
      data: { claudeSessionId, lastActiveAt: new Date() },
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { lastActiveAt: new Date() } });
  }

  async recordMessage(params: {
    controlSessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    durationMs?: number;
  }): Promise<void> {
    await this.prisma.message.create({
      data: {
        controlSessionId: params.controlSessionId,
        role: params.role,
        content: params.content,
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      },
    });
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<ControlSession[]> {
    return this.prisma.controlSession.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async rename(id: string, title: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { title } });
  }

  async archive(id: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}

export const controlSessionManager = new ControlSessionManager(
  // re-use the global prisma exported elsewhere
  (await import('./db.js')).prisma,
);
```

- [ ] **Step 4: Run tests against local Postgres**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" npm test -- src/controlSessionManager.test.ts
```
Expected: 5 tests pass. (Make sure the Postgres container from Task 4 is still running.)

- [ ] **Step 5: Commit**

```bash
git add src/controlSessionManager.ts src/controlSessionManager.test.ts
git commit -m "feat(control-api): ControlSessionManager (CRUD over ControlSession)"
```

---

### Task 6: SSE helper

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\stream.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\stream.test.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\types.ts`

- [ ] **Step 1: Define SSE event types**

`src/api/control/types.ts`:
```ts
// AUTHORITATIVE source for SSE & API contracts shared with apps/control.
// scripts/sync-control-types.ts mirrors this file into apps/control/src/server-types.ts.

export type SseEvent =
  | { event: 'thinking'; data: { at: number } }
  | { event: 'session'; data: { claudeSessionId: string; controlSessionId: string } }
  | { event: 'partial'; data: { text: string } }
  | { event: 'tool'; data: { name: string; input?: string; output?: string; status: 'running' | 'done' } }
  | { event: 'done'; data: { durationMs: number; costUsdInformational: number; isError: boolean } }
  | { event: 'error'; data: { message: string; retryAfterMs?: number } }
  | { event: 'heartbeat'; data: Record<string, never> };

export interface ControlMessageRequest {
  controlSessionId: string | null;
  text: string;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
}

export interface ControlSessionSummary {
  id: string;
  title: string | null;
  claudeSessionId: string | null;
  createdAt: string;
  lastActiveAt: string;
  archivedAt: string | null;
}

export interface ControlMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  durationMs: number | null;
  source: 'desktop' | 'telegram';
}
```

- [ ] **Step 2: Write failing tests**

`src/api/control/stream.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { writeSseFrame, openSseStream } from './stream.js';
import type { Response } from 'express';

function mockRes() {
  const writes: string[] = [];
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
    end: vi.fn(),
  } as unknown as Response & { _writes(): string[] };
  (res as any)._writes = () => writes;
  return res;
}

describe('SSE stream helpers', () => {
  it('writes a properly formatted frame', () => {
    const res = mockRes();
    writeSseFrame(res, { event: 'partial', data: { text: 'hi' } });
    const out = (res as any)._writes().join('');
    expect(out).toBe('event: partial\ndata: {"text":"hi"}\n\n');
  });
  it('openSseStream sets correct headers', () => {
    const res = mockRes();
    openSseStream(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
npm test -- src/api/control/stream.test.ts
```
Expected: cannot resolve module.

- [ ] **Step 4: Implement**

`src/api/control/stream.ts`:
```ts
import type { Response } from 'express';
import type { SseEvent } from './types.js';

export function openSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

export function writeSseFrame(res: Response, frame: SseEvent): void {
  res.write(`event: ${frame.event}\n`);
  res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
}

export function startHeartbeat(res: Response, ms = 25_000): () => void {
  const t = setInterval(() => {
    writeSseFrame(res, { event: 'heartbeat', data: {} });
  }, ms);
  return () => clearInterval(t);
}
```

- [ ] **Step 5: Run, verify PASS**

```bash
npm test -- src/api/control/stream.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/control/stream.ts src/api/control/stream.test.ts src/api/control/types.ts
git commit -m "feat(control-api): SSE stream helpers + shared types"
```

---

### Task 7: Inbox cleanup helper

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\inboxCleanup.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\inboxCleanup.test.ts`

- [ ] **Step 1: Write failing tests**

`src/api/control/inboxCleanup.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupInbox } from './inboxCleanup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inbox-'));
});

describe('cleanupInbox', () => {
  it('deletes files older than maxAgeMs', async () => {
    const old = join(dir, 'old.txt');
    const fresh = join(dir, 'fresh.txt');
    writeFileSync(old, 'old');
    writeFileSync(fresh, 'fresh');
    const tenDaysAgo = Date.now() / 1000 - 10 * 86400;
    utimesSync(old, tenDaysAgo, tenDaysAgo);

    const removed = await cleanupInbox(dir, 7 * 86400 * 1000);
    expect(removed).toBe(1);
    const remaining = readdirSync(dir);
    expect(remaining).toEqual(['fresh.txt']);
  });
  it('returns 0 if directory does not exist', async () => {
    const removed = await cleanupInbox(join(dir, 'no-such-subdir'), 1000);
    expect(removed).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
npm test -- src/api/control/inboxCleanup.test.ts
```

- [ ] **Step 3: Implement**

`src/api/control/inboxCleanup.ts`:
```ts
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger.js';

export async function cleanupInbox(dir: string, maxAgeMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    } catch (err) {
      logger.warn({ err, file: full }, 'inbox cleanup: failed to check/remove file');
    }
  }
  if (removed > 0) logger.info({ removed, dir }, 'inbox cleanup ran');
  return removed;
}

export function startInboxCleanupInterval(dir: string, intervalMs = 3_600_000, maxAgeMs = 7 * 86_400_000) {
  void cleanupInbox(dir, maxAgeMs);
  return setInterval(() => void cleanupInbox(dir, maxAgeMs), intervalMs);
}
```

- [ ] **Step 4: Run, verify PASS**

```bash
npm test -- src/api/control/inboxCleanup.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/control/inboxCleanup.ts src/api/control/inboxCleanup.test.ts
git commit -m "feat(control-api): inbox cleanup setInterval (7-day TTL)"
```

---

### Task 8: POST /control/message route (the core of the system)

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\messageRoute.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\messageRoute.test.ts`

- [ ] **Step 1: Write failing test using a mocked ClaudeBridge**

`src/api/control/messageRoute.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { makeControlMessageRouter } from './messageRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();

class FakeBridge extends EventEmitter {
  constructor(private readonly behaviour: 'success' | 'rate_limit') { super(); }
  async invoke(opts: { message: string; sessionId?: string | null }) {
    setTimeout(() => this.emit('thinking'), 1);
    setTimeout(() => this.emit('sessionId', 'claude-uuid-1'), 2);
    setTimeout(() => this.emit('partial', 'hei '), 3);
    setTimeout(() => this.emit('partial', 'der'), 4);
    if (this.behaviour === 'rate_limit') {
      return { text: '', sessionId: 'claude-uuid-1', durationMs: 10, isError: false, rateLimited: true, costUsd: 0 };
    }
    return { text: 'hei der', sessionId: 'claude-uuid-1', durationMs: 10, isError: false, rateLimited: false, costUsd: 0.001 };
  }
}

beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});
afterAll(async () => { await prisma.$disconnect(); });

function buildApp(behaviour: 'success' | 'rate_limit') {
  const app = express();
  app.use(express.json());
  const mgr = new ControlSessionManager(prisma);
  const bridge = new FakeBridge(behaviour);
  app.use('/control', makeControlMessageRouter({ mgr, makeBridge: () => bridge as any, allowedTokens: ['t1'] }));
  return app;
}

describe('POST /control/message', () => {
  it('streams partial → done frames on success', async () => {
    const res = await request(buildApp('success'))
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    const body = String(res.body);
    expect(body).toContain('event: thinking');
    expect(body).toContain('event: session');
    expect(body).toContain('event: partial');
    expect(body).toContain('event: done');
    const messages = await prisma.message.findMany({});
    expect(messages.map((m) => m.role).sort()).toEqual(['assistant', 'user']);
  });
  it('emits SSE error frame when rate-limited', async () => {
    const res = await request(buildApp('rate_limit'))
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(String(res.body)).toContain('event: error');
    expect(String(res.body)).toContain('rate_limit');
  });
  it('rejects without bearer token', async () => {
    const res = await request(buildApp('success'))
      .post('/control/message')
      .send({ controlSessionId: null, text: 'hei' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" npm test -- src/api/control/messageRoute.test.ts
```

- [ ] **Step 3: Implement the route**

`src/api/control/messageRoute.ts`:
```ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../logger.js';
import type { ClaudeBridge } from '../../claudeBridge.js';
import type { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import { openSseStream, writeSseFrame, startHeartbeat } from './stream.js';

const BodySchema = z.object({
  controlSessionId: z.string().nullable(),
  text: z.string().min(1).max(20_000),
  attachments: z
    .array(
      z.object({
        fileId: z.string(),
        workspacePath: z.string(),
        filename: z.string(),
      }),
    )
    .max(5)
    .optional(),
});

export interface MessageRouterDeps {
  mgr: ControlSessionManager;
  makeBridge: () => Pick<ClaudeBridge, 'invoke' | 'on'>;
  allowedTokens: readonly string[];
}

export function makeControlMessageRouter(deps: MessageRouterDeps): Router {
  const r = Router();
  r.post('/message', makeRequireControlToken(deps.allowedTokens), (req, res) => handle(req, res, deps));
  return r;
}

async function handle(req: Request, res: Response, deps: MessageRouterDeps): Promise<void> {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  let session;
  try {
    session = await deps.mgr.getOrCreate(body.controlSessionId);
  } catch (err) {
    res.status(404).json({ error: 'session_not_found' });
    return;
  }

  let prompt = body.text;
  if (body.attachments?.length) {
    const lines = body.attachments
      .map((a) => `[Vedlegg tilgjengelig: ${a.workspacePath}]`)
      .join('\n');
    prompt = `${body.text}\n\n${lines}`;
  }

  await deps.mgr.recordMessage({
    controlSessionId: session.id,
    role: 'user',
    content: body.text,
  });

  openSseStream(res);
  const stopHeartbeat = startHeartbeat(res);
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const bridge = deps.makeBridge();
  let assistantText = '';
  bridge.on('thinking', () => writeSseFrame(res, { event: 'thinking', data: { at: Date.now() } }));
  bridge.on('partial', (chunk) => {
    assistantText += chunk;
    writeSseFrame(res, { event: 'partial', data: { text: chunk } });
  });
  bridge.on('sessionId', (claudeSessionId) =>
    writeSseFrame(res, { event: 'session', data: { claudeSessionId, controlSessionId: session.id } }),
  );

  logger.info({ controlSessionId: session.id, hasAttachments: !!body.attachments?.length }, 'control.message.start');

  try {
    const result = await bridge.invoke({
      message: prompt,
      sessionId: session.claudeSessionId,
      signal: ac.signal,
    } as any);

    if (result.rateLimited) {
      writeSseFrame(res, { event: 'error', data: { message: 'rate_limit', retryAfterMs: 60_000 } });
    } else if (result.isError) {
      writeSseFrame(res, {
        event: 'error',
        data: { message: result.errorMessage ?? 'bridge_error' },
      });
    } else {
      const finalText = result.text || assistantText;
      if (result.sessionId && result.sessionId !== session.claudeSessionId) {
        await deps.mgr.updateClaudeSessionId(session.id, result.sessionId);
      } else {
        await deps.mgr.touch(session.id);
      }
      await deps.mgr.recordMessage({
        controlSessionId: session.id,
        role: 'assistant',
        content: finalText,
        durationMs: result.durationMs,
      });
      writeSseFrame(res, {
        event: 'done',
        data: { durationMs: result.durationMs, costUsdInformational: result.costUsd, isError: false },
      });
    }
    logger.info({ controlSessionId: session.id, durationMs: result.durationMs, isError: result.isError }, 'control.message.done');
  } catch (err) {
    writeSseFrame(res, { event: 'error', data: { message: String((err as Error).message ?? 'bridge_crash') } });
    logger.error({ err, controlSessionId: session.id }, 'control.message.crash');
  } finally {
    stopHeartbeat();
    res.end();
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" npm test -- src/api/control/messageRoute.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/api/control/messageRoute.ts src/api/control/messageRoute.test.ts
git commit -m "feat(control-api): POST /control/message with SSE streaming"
```

---

### Task 9: Sessions, history, and new-session routes

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\sessionsRoute.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\historyRoute.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\sessionsRoute.test.ts`

- [ ] **Step 1: Write failing test**

`src/api/control/sessionsRoute.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { makeControlSessionsRouter } from './sessionsRoute.js';
import { makeControlHistoryRouter } from './historyRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();
beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
  await prisma.session.deleteMany({});
});
afterAll(async () => { await prisma.$disconnect(); });

function app() {
  const a = express();
  a.use(express.json());
  const mgr = new ControlSessionManager(prisma);
  a.use('/control', makeControlSessionsRouter({ mgr, prisma, allowedTokens: ['t1'] }));
  a.use('/control', makeControlHistoryRouter({ prisma, allowedTokens: ['t1'] }));
  return a;
}

describe('control sessions + history', () => {
  it('creates a new desktop session', async () => {
    const res = await request(app())
      .post('/control/session/new')
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toMatch(/Ny tråd/);
  });
  it('lists sessions and messages', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'A' } });
    await prisma.message.create({
      data: { controlSessionId: created.id, role: 'user', content: 'hei' },
    });

    const list = await request(app())
      .get('/control/sessions')
      .set('Authorization', 'Bearer t1');
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(1);

    const msgs = await request(app())
      .get(`/control/sessions/${created.id}/messages`)
      .set('Authorization', 'Bearer t1');
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages).toHaveLength(1);
    expect(msgs.body.messages[0].source).toBe('desktop');
  });
  it('returns telegram messages with source=telegram', async () => {
    const tg = await prisma.session.create({ data: { telegramChatId: BigInt(7341469970) } });
    await prisma.message.create({ data: { sessionId: tg.id, role: 'user', content: 'tg-hi' } });
    const res = await request(app())
      .get('/control/history?source=telegram&limit=10')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.messages.every((m: any) => m.source === 'telegram')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" npm test -- src/api/control/sessionsRoute.test.ts
```

- [ ] **Step 3: Implement sessions route**

`src/api/control/sessionsRoute.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import type { ControlSessionSummary, ControlMessageRow } from './types.js';

const RenameBody = z.object({ title: z.string().min(1).max(120) });

export interface SessionsRouterDeps {
  mgr: ControlSessionManager;
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

export function makeControlSessionsRouter(deps: SessionsRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/sessions', auth, async (_req, res) => {
    const rows = await deps.mgr.list();
    const sessions: ControlSessionSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      claudeSessionId: row.claudeSessionId,
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
    res.json({ sessions });
  });

  r.post('/session/new', auth, async (_req, res) => {
    const s = await deps.mgr.getOrCreate(null);
    const row = await deps.prisma.controlSession.findUnique({ where: { id: s.id } });
    res.json({
      id: row!.id,
      title: row!.title,
      claudeSessionId: row!.claudeSessionId,
      createdAt: row!.createdAt.toISOString(),
      lastActiveAt: row!.lastActiveAt.toISOString(),
      archivedAt: null,
    });
  });

  r.patch('/sessions/:id', auth, async (req, res) => {
    const parsed = RenameBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    await deps.mgr.rename(req.params.id!, parsed.data.title);
    res.json({ ok: true });
  });

  r.post('/sessions/:id/archive', auth, async (req, res) => {
    await deps.mgr.archive(req.params.id!);
    res.json({ ok: true });
  });

  r.get('/sessions/:id/messages', auth, async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const messages = await deps.prisma.message.findMany({
      where: {
        controlSessionId: req.params.id!,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const out: ControlMessageRow[] = messages.map((m) => ({
      id: m.id,
      role: m.role as ControlMessageRow['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      durationMs: m.durationMs,
      source: 'desktop',
    }));
    res.json({ messages: out });
  });

  return r;
}
```

- [ ] **Step 4: Implement history route**

`src/api/control/historyRoute.ts`:
```ts
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { makeRequireControlToken } from './auth.js';
import type { ControlMessageRow } from './types.js';

const Query = z.object({
  source: z.enum(['telegram', 'desktop', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().datetime().optional(),
});

export interface HistoryRouterDeps {
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

export function makeControlHistoryRouter(deps: HistoryRouterDeps): Router {
  const r = Router();
  r.get('/history', makeRequireControlToken(deps.allowedTokens), async (req, res) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    const { source, limit, before } = parsed.data;
    const where: any = {};
    if (source === 'telegram') where.sessionId = { not: null };
    if (source === 'desktop') where.controlSessionId = { not: null };
    if (before) where.createdAt = { lt: new Date(before) };

    const rows = await deps.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const messages: ControlMessageRow[] = rows.map((m) => ({
      id: m.id,
      role: m.role as ControlMessageRow['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      durationMs: m.durationMs,
      source: m.sessionId ? 'telegram' : 'desktop',
    }));
    res.json({ messages });
  });
  return r;
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" npm test -- src/api/control/sessionsRoute.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/control/sessionsRoute.ts src/api/control/historyRoute.ts src/api/control/sessionsRoute.test.ts
git commit -m "feat(control-api): GET /control/sessions, /history, POST /control/session/new"
```

---

### Task 10: POST /control/upload route

**Files:**
- Create: `C:\Users\benja\nordrise-ai\src\api\control\uploadRoute.ts`
- Create: `C:\Users\benja\nordrise-ai\src\api\control\uploadRoute.test.ts`
- Modify: `C:\Users\benja\nordrise-ai\package.json` (add `multer`, `file-type`, `cuid2`)

- [ ] **Step 1: Install deps**

```bash
npm install multer@1.4.5-lts.1 file-type@19.6.0 @paralleldrive/cuid2@2.2.2
npm install --save-dev @types/multer@1.4.12
```

- [ ] **Step 2: Write failing test**

`src/api/control/uploadRoute.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { makeControlUploadRouter } from './uploadRoute.js';

let inboxDir: string;
beforeEach(() => {
  inboxDir = mkdtempSync(join(tmpdir(), 'inbox-'));
});

function app() {
  const a = express();
  a.use('/control', makeControlUploadRouter({ inboxDir, allowedTokens: ['t1'], maxFileSizeBytes: 25 * 1024 * 1024 }));
  return a;
}

describe('POST /control/upload', () => {
  it('rejects without bearer', async () => {
    const res = await request(app()).post('/control/upload').attach('file', Buffer.from('hi'), 'a.txt');
    expect(res.status).toBe(401);
  });
  it('writes file with cuid prefix and returns workspacePath', async () => {
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', Buffer.from('hello'), 'note.txt');
    expect(res.status).toBe(200);
    expect(res.body.workspacePath).toMatch(/note\.txt$/);
    const onDisk = readdirSync(inboxDir);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatch(/-note\.txt$/);
  });
  it('rejects executable by magic-byte sniff', async () => {
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', exeBytes, 'evil.exe');
    expect(res.status).toBe(415);
  });
  it('sanitizes filename', async () => {
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', Buffer.from('x'), '../../../etc/passwd.txt');
    expect(res.status).toBe(200);
    expect(res.body.workspacePath).not.toContain('..');
    expect(res.body.workspacePath).toMatch(/passwd\.txt$/);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

```bash
npm test -- src/api/control/uploadRoute.test.ts
```

- [ ] **Step 4: Implement upload route**

`src/api/control/uploadRoute.ts`:
```ts
import { Router } from 'express';
import multer from 'multer';
import { createId } from '@paralleldrive/cuid2';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger.js';
import { makeRequireControlToken } from './auth.js';

const FORBIDDEN_MIME_PREFIXES = ['application/x-msdownload', 'application/x-executable', 'application/x-dosexec'];

export interface UploadRouterDeps {
  inboxDir: string;
  allowedTokens: readonly string[];
  maxFileSizeBytes: number;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 200) || 'file';
}

export function makeControlUploadRouter(deps: UploadRouterDeps): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxFileSizeBytes, files: 1 },
  });

  r.post(
    '/upload',
    makeRequireControlToken(deps.allowedTokens),
    upload.single('file'),
    async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'no_file' });
        return;
      }
      const sniff = await fileTypeFromBuffer(req.file.buffer);
      if (sniff && FORBIDDEN_MIME_PREFIXES.some((p) => sniff.mime.startsWith(p))) {
        res.status(415).json({ error: 'forbidden_mime', detected: sniff.mime });
        return;
      }
      const cuid = createId();
      const safeName = sanitize(req.file.originalname);
      const fileId = cuid;
      const onDiskName = `${cuid}-${safeName}`;
      const fullPath = join(deps.inboxDir, onDiskName);

      try {
        await mkdir(deps.inboxDir, { recursive: true });
        await writeFile(fullPath, req.file.buffer);
      } catch (err) {
        logger.error({ err }, 'control.upload write failed');
        res.status(500).json({ error: 'write_failed' });
        return;
      }

      logger.info(
        { fileId, size: req.file.size, mime: sniff?.mime ?? req.file.mimetype },
        'control.upload',
      );
      res.json({ fileId, workspacePath: fullPath, filename: safeName, size: req.file.size });
    },
  );

  // multer's payload-too-large produces an error; surface as 413
  r.use((err: any, _req: any, res: any, next: any) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'file_too_large' });
      return;
    }
    next(err);
  });

  return r;
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npm test -- src/api/control/uploadRoute.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/control/uploadRoute.ts src/api/control/uploadRoute.test.ts package.json package-lock.json
git commit -m "feat(control-api): POST /control/upload with magic-byte sniff + sanitization"
```

---

### Task 11: Mount /control on gateway, deploy, smoke test

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\src\gateway.ts`
- Modify: `C:\Users\benja\nordrise-ai\src\config.ts` (already has CONTROL_API_TOKENS — verify)

- [ ] **Step 1: Wire it up in `src/gateway.ts`**

Imports near top:
```ts
import { join } from 'node:path';
import { ClaudeBridge } from './claudeBridge.js';
import { controlSessionManager } from './controlSessionManager.js';
import { controlTokens } from './config.js';
import { makeControlMessageRouter } from './api/control/messageRoute.js';
import { makeControlSessionsRouter } from './api/control/sessionsRoute.js';
import { makeControlHistoryRouter } from './api/control/historyRoute.js';
import { makeControlUploadRouter } from './api/control/uploadRoute.js';
import { startInboxCleanupInterval } from './api/control/inboxCleanup.js';
```

After `app.use(express.json(...))`:
```ts
const inboxDir = join(config.WORKSPACE_DIR, 'inbox');
const controlRouter = (() => {
  const r = require('express').Router();
  r.use(makeControlMessageRouter({
    mgr: controlSessionManager,
    makeBridge: () => new ClaudeBridge(),
    allowedTokens: controlTokens,
  }));
  r.use(makeControlSessionsRouter({ mgr: controlSessionManager, prisma, allowedTokens: controlTokens }));
  r.use(makeControlHistoryRouter({ prisma, allowedTokens: controlTokens }));
  r.use(makeControlUploadRouter({ inboxDir, allowedTokens: controlTokens, maxFileSizeBytes: 25 * 1024 * 1024 }));
  return r;
})();
app.use('/control', controlRouter);
```

Note: ESM doesn't have `require`. Replace the IIFE with named imports + a real `Router()`:

```ts
import { Router } from 'express';
// ...
const controlRouter = Router();
controlRouter.use(makeControlMessageRouter({
  mgr: controlSessionManager,
  makeBridge: () => new ClaudeBridge(),
  allowedTokens: controlTokens,
}));
controlRouter.use(makeControlSessionsRouter({ mgr: controlSessionManager, prisma, allowedTokens: controlTokens }));
controlRouter.use(makeControlHistoryRouter({ prisma, allowedTokens: controlTokens }));
controlRouter.use(makeControlUploadRouter({ inboxDir, allowedTokens: controlTokens, maxFileSizeBytes: 25 * 1024 * 1024 }));
app.use('/control', controlRouter);
```

In `main()`, after `await initTelegramBot();`:
```ts
const cleanupTimer = startInboxCleanupInterval(inboxDir);
```

In the `shutdown` handler, add `clearInterval(cleanupTimer);` before `server.close`.

- [ ] **Step 2: Type-check + run all tests + build**

```bash
npm run typecheck && npm test && npm run build
```
Expected: green.

- [ ] **Step 3: Local smoke test**

In one terminal:
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" \
CONTROL_API_TOKENS="local-test-token" \
TELEGRAM_BOT_TOKEN="<dev>" \
TELEGRAM_WEBHOOK_SECRET="<dev>" \
CLAUDE_CODE_OAUTH_TOKEN="<your-token>" \
npm run dev
```

In another:
```bash
curl -s http://localhost:3000/healthz
curl -s -X POST -H "Authorization: Bearer local-test-token" \
  http://localhost:3000/control/session/new -d '{}' -H 'content-type: application/json'
```
Expected: healthz returns 200; session/new returns a JSON object with `id`.

- [ ] **Step 4: Commit**

```bash
git add src/gateway.ts
git commit -m "feat(gateway): mount /control routes + start inbox cleanup"
```

- [ ] **Step 5: Push to Railway**

```bash
railway up --service sean
# Or push to a GitHub remote and let Railway auto-deploy.
```

Watch logs:
```bash
railway logs --json --service sean | tail -30
```
Expected: `gateway listening` + `inbox cleanup ran` (with `removed: 0`) on boot.

- [ ] **Step 6: Issue first prod token + add to Railway env**

```bash
npm run issue-control-token
# copy printed token, then:
railway variables --set CONTROL_API_TOKENS="<token>" --service sean
```

Wait for redeploy, then:
```bash
curl -s -X POST -H "Authorization: Bearer <token>" \
  https://sean-production-4fcf.up.railway.app/control/session/new \
  -d '{}' -H 'content-type: application/json'
```
Expected: 200 with new ControlSession JSON.

- [ ] **Step 7: M1 done — open PR**

```bash
git push -u origin main  # if you've added a remote; otherwise skip
```

PR title: `feat: Sean Control v1 — M1 backend foundation`

---

# Milestone M2 — Electron + Next.js scaffolding (Tasks 12-18)

Goal: `apps/control/` is a separate Node project. Electron launches a Next.js renderer window. Onboarding accepts the bearer token, stores it in Windows Credential Manager via `keytar`, then uses it to call `/healthz` against the Railway backend. Tray icon appears.

---

### Task 12: Initialize `apps/control/` as a sibling project

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\package.json`
- Create: `C:\Users\benja\nordrise-ai\apps\control\tsconfig.json`
- Create: `C:\Users\benja\nordrise-ai\apps\control\.gitignore`
- Create: `C:\Users\benja\nordrise-ai\apps\control\vitest.config.ts`

- [ ] **Step 1: Make directory and init**

```bash
mkdir -p /c/Users/benja/nordrise-ai/apps/control
cd /c/Users/benja/nordrise-ai/apps/control
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "nordrise-control",
  "version": "0.1.0",
  "private": true,
  "description": "Nordrise Control — Sean desktop client.",
  "main": "dist/main/index.js",
  "type": "module",
  "scripts": {
    "dev:renderer": "next dev renderer -p 4001",
    "build:renderer": "next build renderer && next export renderer -o dist/renderer",
    "build:main": "tsc -p tsconfig.main.json",
    "build:preload": "tsc -p tsconfig.preload.json",
    "build": "npm run build:renderer && npm run build:main && npm run build:preload && node scripts/copy-assets.mjs",
    "start": "electron dist/main/index.js",
    "dev": "concurrently -k \"npm:dev:renderer\" \"npm:dev:electron\"",
    "dev:electron": "wait-on http://localhost:4001 && cross-env NODE_ENV=development electron .",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.main.json --noEmit && tsc -p tsconfig.preload.json --noEmit",
    "package": "electron-builder",
    "package:dir": "electron-builder --dir"
  },
  "dependencies": {
    "better-sqlite3": "11.5.0",
    "electron-updater": "6.3.9",
    "keytar": "7.9.0",
    "next": "14.2.18",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.12",
    "@types/node": "20.17.9",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "4.3.4",
    "autoprefixer": "10.4.20",
    "concurrently": "9.1.0",
    "cross-env": "7.0.3",
    "electron": "33.2.0",
    "electron-builder": "25.1.8",
    "jsdom": "25.0.1",
    "postcss": "8.4.49",
    "tailwindcss": "3.4.15",
    "typescript": "5.6.3",
    "vitest": "2.1.8",
    "wait-on": "8.0.1",
    "@testing-library/react": "16.0.1",
    "@testing-library/jest-dom": "6.6.3"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json` (renderer base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./renderer/*"] }
  },
  "include": ["renderer/**/*.ts", "renderer/**/*.tsx", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "main", "preload"]
}
```

- [ ] **Step 4: Create `tsconfig.main.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist/main",
    "rootDir": "main",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["main/**/*.ts"]
}
```

- [ ] **Step 5: Create `tsconfig.preload.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist/preload",
    "rootDir": "preload",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["preload/**/*.ts"]
}
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules
dist
.next
out
release
*.tsbuildinfo
```

- [ ] **Step 7: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['renderer/**/*.test.ts', 'renderer/**/*.test.tsx', 'main/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./renderer/test-setup.ts'],
  },
});
```

- [ ] **Step 8: Install everything**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm install
```
This will take a couple of minutes (Electron, native modules).

- [ ] **Step 9: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/package.json apps/control/package-lock.json apps/control/tsconfig.json apps/control/tsconfig.main.json apps/control/tsconfig.preload.json apps/control/.gitignore apps/control/vitest.config.ts
git commit -m "chore(control): scaffold apps/control/ sibling project"
```

---

### Task 13: Type sync script

**Files:**
- Create: `C:\Users\benja\nordrise-ai\scripts\sync-control-types.ts`
- Modify: `C:\Users\benja\nordrise-ai\package.json` (add script + run before commits via husky)

- [ ] **Step 1: Add the sync script**

`scripts/sync-control-types.ts`:
```ts
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const src = resolve('src/api/control/types.ts');
const destDir = resolve('apps/control/src');
const dest = resolve(destDir, 'server-types.ts');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
process.stdout.write(`Synced ${src} -> ${dest}\n`);
```

- [ ] **Step 2: Add npm script**

In root `package.json` `"scripts"`:
```json
"sync-control-types": "tsx scripts/sync-control-types.ts"
```

- [ ] **Step 3: Run it once**

```bash
npm run sync-control-types
```
Expected: copies the file. Verify `apps/control/src/server-types.ts` exists.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-control-types.ts package.json apps/control/src/server-types.ts
git commit -m "chore(control): add sync-control-types script"
```

---

### Task 14: Electron main process — minimal window

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\index.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\windows.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\index.test.ts` (smoke only)

- [ ] **Step 1: Write a smoke test for the windows-config helper**

`apps/control/main/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mainWindowOptions } from './windows.js';

describe('mainWindowOptions', () => {
  it('disables nodeIntegration and enables contextIsolation', () => {
    const opts = mainWindowOptions('/abs/preload.js');
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.sandbox).toBe(true);
    expect(opts.webPreferences?.preload).toBe('/abs/preload.js');
  });
});
```

- [ ] **Step 2: Implement `windows.ts`**

```ts
import type { BrowserWindowConstructorOptions } from 'electron';

export function mainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b0e',
    title: 'Nordrise Control',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function miniPopupWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 600,
    height: 140,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#0b0b0e',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}
```

- [ ] **Step 3: Implement `main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mainWindowOptions } from './windows.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWin: BrowserWindow | null = null;

function preloadPath(): string {
  return join(__dirname, '..', 'preload', 'index.js');
}

function rendererURL(): string {
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:4001';
  }
  return `file://${join(__dirname, '..', 'renderer', 'index.html')}`;
}

async function createMainWindow() {
  mainWin = new BrowserWindow(mainWindowOptions(preloadPath()));
  await mainWin.loadURL(rendererURL());
  mainWin.once('ready-to-show', () => mainWin?.show());
  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
```

- [ ] **Step 4: Run vitest**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm test
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/main
git commit -m "feat(electron): main process + secure window options"
```

---

### Task 15: Preload + contextBridge IPC

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\preload\index.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\types\bridge.d.ts`

- [ ] **Step 1: Implement preload**

`apps/control/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  invoke: <T = unknown>(channel: string, payload?: unknown) =>
    ipcRenderer.invoke(channel, payload) as Promise<T>,

  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_evt: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
  },
};

contextBridge.exposeInMainWorld('nordrise', api);
export type NordriseBridge = typeof api;
```

- [ ] **Step 2: Type declaration for renderer**

`apps/control/renderer/types/bridge.d.ts`:
```ts
import type { NordriseBridge } from '../../preload';

declare global {
  interface Window {
    nordrise: NordriseBridge;
  }
}
export {};
```

- [ ] **Step 3: Type-check**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/preload apps/control/renderer/types
git commit -m "feat(electron): preload + contextBridge api surface"
```

---

### Task 16: Next.js renderer skeleton + Tailwind + Nordrise theme

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\next.config.mjs`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\tailwind.config.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\postcss.config.mjs`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\app\layout.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\app\page.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\app\globals.css`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\test-setup.ts`

- [ ] **Step 1: `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};
export default nextConfig;
```

- [ ] **Step 2: `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./renderer/app/**/*.{ts,tsx}', './renderer/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#0b0b0e', elev: '#15151a', surface: '#1d1d24' },
        border: { DEFAULT: '#2a2a32', strong: '#3a3a44' },
        text: { DEFAULT: '#e6e6ec', muted: '#8a8a96', subtle: '#5b5b66' },
        accent: { DEFAULT: '#7c5cff', hover: '#8e72ff', soft: '#2a2150' },
        success: '#3fb27f',
        warn: '#e2b73c',
        danger: '#e25b5b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: `postcss.config.mjs`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 4: `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #__next { height: 100%; }
body {
  @apply bg-bg text-text font-sans antialiased;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: `app/layout.tsx`**

```tsx
import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Nordrise Control',
  description: 'Sean desktop client',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: `app/page.tsx` (placeholder)**

```tsx
'use client';
export default function Page() {
  return (
    <main className="grid h-screen place-items-center text-text">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Nordrise Control</h1>
        <p className="text-text-muted mt-2">Loading…</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: `test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 8: Verify dev server boots**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run dev:renderer
```
Open http://localhost:4001 — should show the placeholder. Kill it.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/renderer
git commit -m "feat(renderer): Next.js + Tailwind + Nordrise dark theme"
```

---

### Task 17: keytar wrapper + onboarding flow

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\keychain.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\ipc.ts`
- Modify: `C:\Users\benja\nordrise-ai\apps\control\main\index.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\app\page.tsx` (replace placeholder)
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\Onboarding.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\lib\bridge.ts`

- [ ] **Step 1: keychain wrapper**

`apps/control/main/keychain.ts`:
```ts
import { safeStorage } from 'electron';
import { app } from 'electron';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';

const SERVICE = 'nordrise-control';
const ACCOUNT = 'bearer';

let keytarMod: typeof import('keytar') | null = null;
async function tryKeytar() {
  if (keytarMod !== null) return keytarMod;
  try {
    keytarMod = await import('keytar');
  } catch {
    keytarMod = null;
  }
  return keytarMod;
}

export async function setToken(token: string): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.setPassword(SERVICE, ACCOUNT, token); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('no_secure_storage');
  const blob = safeStorage.encryptString(token);
  const path = join(app.getPath('userData'), 'token.bin');
  await writeFile(path, blob);
}

export async function getToken(): Promise<string | null> {
  const k = await tryKeytar();
  if (k) return k.getPassword(SERVICE, ACCOUNT);
  try {
    const path = join(app.getPath('userData'), 'token.bin');
    const blob = await readFile(path);
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(blob);
  } catch {
    return null;
  }
}

export async function deleteToken(): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.deletePassword(SERVICE, ACCOUNT); return; }
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(join(app.getPath('userData'), 'token.bin'));
  } catch { /* idempotent */ }
}
```

- [ ] **Step 2: IPC handlers**

`apps/control/main/ipc.ts`:
```ts
import { ipcMain } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';

const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';

export function registerIpc(): void {
  ipcMain.handle('auth:get-token', () => getToken());
  ipcMain.handle('auth:set-token', (_e, token: string) => setToken(token));
  ipcMain.handle('auth:delete-token', () => deleteToken());

  ipcMain.handle('config:backend-url', () => process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND);

  ipcMain.handle('healthz', async () => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const r = await fetch(`${backend}/healthz`);
    return { status: r.status, body: await r.json().catch(() => null) };
  });
}
```

- [ ] **Step 3: Wire IPC into main**

In `apps/control/main/index.ts`, after `import { mainWindowOptions } from './windows.js';`, add:
```ts
import { registerIpc } from './ipc.js';
```
And in `app.whenReady().then(...)`, call `registerIpc()` first:
```ts
app.whenReady().then(() => {
  registerIpc();
  return createMainWindow();
});
```

- [ ] **Step 4: Renderer bridge wrapper**

`apps/control/renderer/lib/bridge.ts`:
```ts
export async function getStoredToken(): Promise<string | null> {
  return window.nordrise.invoke<string | null>('auth:get-token');
}
export async function setStoredToken(token: string): Promise<void> {
  await window.nordrise.invoke<void>('auth:set-token', token);
}
export async function deleteStoredToken(): Promise<void> {
  await window.nordrise.invoke<void>('auth:delete-token');
}
export async function getBackendUrl(): Promise<string> {
  return window.nordrise.invoke<string>('config:backend-url');
}
export async function pingHealthz(): Promise<{ status: number; body: any }> {
  return window.nordrise.invoke('healthz');
}
```

- [ ] **Step 5: Onboarding component**

`apps/control/renderer/components/Onboarding.tsx`:
```tsx
'use client';
import { useState } from 'react';
import { setStoredToken, pingHealthz } from '../lib/bridge';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const trimmed = token.trim();
      if (trimmed.length < 32) {
        setError('Token må være minst 32 tegn.');
        return;
      }
      await setStoredToken(trimmed);
      const hz = await pingHealthz();
      if (hz.status !== 200) {
        setError(`Backend svarte ${hz.status}. Sjekk at Sean kjører.`);
        return;
      }
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <main className="grid h-screen place-items-center bg-bg text-text">
      <form onSubmit={submit} className="w-[420px] rounded-2xl border border-border bg-bg-elev p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-1">Nordrise Control</h1>
        <p className="text-text-muted text-sm mb-6">Lim inn din Sean control-token (fra <code>npm run issue-control-token</code> + Railway env).</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="sk-... eller hex"
          className="w-full rounded-lg bg-bg-surface border border-border-strong px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
          autoFocus
        />
        {error && <p className="mt-3 text-danger text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent hover:bg-accent-hover py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Verifiserer…' : 'Koble til Sean'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Replace `app/page.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Onboarding } from '../components/Onboarding';
import { getStoredToken } from '../lib/bridge';

export default function Page() {
  const [phase, setPhase] = useState<'loading' | 'onboarding' | 'app'>('loading');

  useEffect(() => {
    getStoredToken().then((tok) => setPhase(tok ? 'app' : 'onboarding'));
  }, []);

  if (phase === 'loading') return <main className="grid h-screen place-items-center text-text-muted">Laster…</main>;
  if (phase === 'onboarding') return <Onboarding onDone={() => setPhase('app')} />;
  return (
    <main className="grid h-screen place-items-center text-text">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">✓ Koblet til Sean</h1>
        <p className="text-text-muted mt-2">Chat-vinduet kommer i M3.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Verify dev**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run build:main && npm run build:preload
npm run dev
```
The Electron window opens, shows onboarding. Paste your prod token, click "Koble til Sean", should land on the placeholder "✓ Koblet til Sean" page.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/main/keychain.ts apps/control/main/ipc.ts apps/control/main/index.ts apps/control/renderer
git commit -m "feat(control): keytar token storage + onboarding flow"
```

---

### Task 18: Tray icon

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\tray.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\assets\tray-green.png` (16×16, solid #3fb27f circle on transparent — make in any tool)
- Create: `C:\Users\benja\nordrise-ai\apps\control\assets\tray-yellow.png`
- Create: `C:\Users\benja\nordrise-ai\apps\control\assets\tray-red.png`
- Modify: `C:\Users\benja\nordrise-ai\apps\control\main\index.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\scripts\copy-assets.mjs`

- [ ] **Step 1: Generate the three tray icons**

Use any image editor to create three 16×16 PNGs with a solid colored circle (#3fb27f, #e2b73c, #e25b5b) on transparent background. Place in `apps/control/assets/`. As a quick alternative, use ImageMagick:
```bash
mkdir -p /c/Users/benja/nordrise-ai/apps/control/assets
magick -size 16x16 xc:none -fill "#3fb27f" -draw "circle 8,8 8,3" /c/Users/benja/nordrise-ai/apps/control/assets/tray-green.png
magick -size 16x16 xc:none -fill "#e2b73c" -draw "circle 8,8 8,3" /c/Users/benja/nordrise-ai/apps/control/assets/tray-yellow.png
magick -size 16x16 xc:none -fill "#e25b5b" -draw "circle 8,8 8,3" /c/Users/benja/nordrise-ai/apps/control/assets/tray-red.png
```
If you don't have ImageMagick: any 16×16 PNG works for now; ship better art later.

- [ ] **Step 2: Asset-copy script**

`apps/control/scripts/copy-assets.mjs`:
```js
import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });
process.stdout.write('Assets copied to dist/assets\n');
```

- [ ] **Step 3: Tray module**

`apps/control/main/tray.ts`:
```ts
import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TrayStatus = 'green' | 'yellow' | 'red';

let tray: Tray | null = null;

function iconPath(status: TrayStatus): string {
  return join(__dirname, '..', 'assets', `tray-${status}.png`);
}

export function initTray(getMainWindow: () => BrowserWindow | null): void {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(iconPath('green')));
  tray.setToolTip('Nordrise Control');
  refreshMenu(getMainWindow);
  tray.on('click', () => {
    const w = getMainWindow();
    if (w) { w.show(); w.focus(); }
  });
}

export function setTrayStatus(status: TrayStatus): void {
  if (!tray) return;
  tray.setImage(nativeImage.createFromPath(iconPath(status)));
}

function refreshMenu(getMainWindow: () => BrowserWindow | null): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Åpne', click: () => { const w = getMainWindow(); w?.show(); w?.focus(); } },
    { type: 'separator' },
    { label: 'Avslutt', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}
```

- [ ] **Step 4: Wire tray into `main/index.ts`**

Add import and call `initTray` in the `app.whenReady` block:
```ts
import { initTray, setTrayStatus } from './tray.js';
// ...
app.whenReady().then(async () => {
  registerIpc();
  await createMainWindow();
  initTray(() => mainWin);
  // poll healthz every 30s and update tray
  setInterval(async () => {
    try {
      const url = process.env.NORDRISE_BACKEND_URL ?? 'https://sean-production-4fcf.up.railway.app';
      const r = await fetch(`${url}/healthz`);
      const body = (await r.json()) as { authMode?: string; db?: string };
      if (r.status === 200 && body.authMode === 'subscription' && body.db === 'ok') setTrayStatus('green');
      else setTrayStatus('yellow');
    } catch {
      setTrayStatus('red');
    }
  }, 30_000);
});
```

- [ ] **Step 5: Build, run, verify tray appears**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run build:main
node scripts/copy-assets.mjs
npm run dev
```
Tray icon appears in Windows system tray with right-click menu.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/main/tray.ts apps/control/main/index.ts apps/control/assets apps/control/scripts/copy-assets.mjs
git commit -m "feat(electron): tray icon with healthz-driven status"
```

---

# Milestone M3 — Chat + streaming + thread list (Tasks 19-25)

Goal: User can pick a thread, type a message, and watch Sean reply token-by-token. Tool calls show in the right thinking panel. Telegram history is read-only in the same UI.

---

### Task 19: Typed API client + SSE consumer hook

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\lib\api.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\hooks\useSSE.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\hooks\useSSE.test.tsx`

- [ ] **Step 1: API client**

`apps/control/renderer/lib/api.ts`:
```ts
import type { ControlSessionSummary, ControlMessageRow } from '../../src/server-types';
import { getStoredToken, getBackendUrl } from './bridge';

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const [tok, base] = await Promise.all([getStoredToken(), getBackendUrl()]);
  if (!tok) throw new Error('no_token');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${tok}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

export async function listSessions(): Promise<ControlSessionSummary[]> {
  const r = await authedFetch('/control/sessions');
  if (!r.ok) throw new Error(`sessions ${r.status}`);
  const body = await r.json();
  return body.sessions;
}

export async function newSession(): Promise<ControlSessionSummary> {
  const r = await authedFetch('/control/session/new', { method: 'POST', body: '{}' });
  if (!r.ok) throw new Error(`new session ${r.status}`);
  return r.json();
}

export async function listMessages(sessionId: string, since?: string): Promise<ControlMessageRow[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const r = await authedFetch(`/control/sessions/${sessionId}/messages${q}`);
  if (!r.ok) throw new Error(`messages ${r.status}`);
  const body = await r.json();
  return body.messages;
}

export async function listHistory(source: 'telegram' | 'all' = 'telegram', limit = 100): Promise<ControlMessageRow[]> {
  const r = await authedFetch(`/control/history?source=${source}&limit=${limit}`);
  if (!r.ok) throw new Error(`history ${r.status}`);
  const body = await r.json();
  return body.messages;
}

export interface SendOpts {
  controlSessionId: string | null;
  text: string;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  signal?: AbortSignal;
}

export async function sendMessageStream(opts: SendOpts): Promise<Response> {
  return authedFetch('/control/message', {
    method: 'POST',
    body: JSON.stringify({ controlSessionId: opts.controlSessionId, text: opts.text, attachments: opts.attachments }),
    signal: opts.signal,
  });
}
```

- [ ] **Step 2: Write failing test for SSE parser**

`apps/control/renderer/hooks/useSSE.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { parseSseFrames } from './useSSE';

describe('parseSseFrames', () => {
  it('parses a single complete frame', () => {
    const out = parseSseFrames('event: partial\ndata: {"text":"hi"}\n\n');
    expect(out.frames).toHaveLength(1);
    expect(out.frames[0]).toEqual({ event: 'partial', data: { text: 'hi' } });
    expect(out.remainder).toBe('');
  });
  it('handles multiple frames in one buffer', () => {
    const buf = 'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n';
    const out = parseSseFrames(buf);
    expect(out.frames).toHaveLength(2);
  });
  it('keeps incomplete frame as remainder', () => {
    const out = parseSseFrames('event: partial\ndata: {"text":"');
    expect(out.frames).toHaveLength(0);
    expect(out.remainder).toBe('event: partial\ndata: {"text":"');
  });
});
```

- [ ] **Step 3: Implement SSE consumer**

`apps/control/renderer/hooks/useSSE.ts`:
```ts
import { useEffect, useRef, useState } from 'react';

export interface SseFrame { event: string; data: any }

export function parseSseFrames(buffer: string): { frames: SseFrame[]; remainder: string } {
  const frames: SseFrame[] = [];
  let remainder = buffer;
  while (true) {
    const idx = remainder.indexOf('\n\n');
    if (idx < 0) break;
    const block = remainder.slice(0, idx);
    remainder = remainder.slice(idx + 2);
    const lines = block.split('\n');
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    try {
      frames.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // skip malformed
    }
  }
  return { frames, remainder };
}

export interface SseStatus {
  state: 'idle' | 'connecting' | 'streaming' | 'done' | 'error';
  error?: string;
}

export interface SseHandlers {
  onFrame: (frame: SseFrame) => void;
  onStatus?: (status: SseStatus) => void;
}

export async function consumeSseResponse(res: Response, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  if (!res.body) {
    handlers.onStatus?.({ state: 'error', error: 'no_body' });
    return;
  }
  if (!res.ok) {
    handlers.onStatus?.({ state: 'error', error: `http_${res.status}` });
    return;
  }
  handlers.onStatus?.({ state: 'streaming' });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { frames, remainder } = parseSseFrames(buf);
      buf = remainder;
      for (const f of frames) handlers.onFrame(f);
    }
    handlers.onStatus?.({ state: 'done' });
  } catch (err) {
    handlers.onStatus?.({ state: 'error', error: String((err as Error).message) });
  }
}

export function useSseStatus() {
  const [status, setStatus] = useState<SseStatus>({ state: 'idle' });
  return { status, setStatus };
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm test -- renderer/hooks/useSSE.test.tsx
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/renderer/lib/api.ts apps/control/renderer/hooks
git commit -m "feat(renderer): typed API client + SSE parser"
```

---

### Task 20: ChatView component with streaming

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\ChatView.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\Message.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\Composer.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\state\thread.ts`

- [ ] **Step 1: Thread state hook (small Zustand-free reducer)**

`apps/control/renderer/state/thread.ts`:
```ts
import { useReducer, useCallback } from 'react';
import type { ControlMessageRow } from '../../src/server-types';

interface State {
  messages: ControlMessageRow[];
  streaming: boolean;
  toolCalls: Array<{ id: string; name: string; input?: string; output?: string; status: 'running' | 'done' }>;
}

type Action =
  | { type: 'set'; messages: ControlMessageRow[] }
  | { type: 'add-user'; content: string }
  | { type: 'start-assistant' }
  | { type: 'append-assistant'; chunk: string }
  | { type: 'finish-assistant' }
  | { type: 'tool'; name: string; input?: string; output?: string; status: 'running' | 'done' }
  | { type: 'error'; message: string };

const initial: State = { messages: [], streaming: false, toolCalls: [] };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'set':
      return { ...state, messages: action.messages };
    case 'add-user':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `local-${Date.now()}`,
            role: 'user',
            content: action.content,
            createdAt: new Date().toISOString(),
            durationMs: null,
            source: 'desktop',
          },
        ],
      };
    case 'start-assistant':
      return {
        ...state,
        streaming: true,
        toolCalls: [],
        messages: [
          ...state.messages,
          {
            id: `local-asst-${Date.now()}`,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            durationMs: null,
            source: 'desktop',
          },
        ],
      };
    case 'append-assistant': {
      const msgs = state.messages.slice();
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + action.chunk };
      }
      return { ...state, messages: msgs };
    }
    case 'finish-assistant':
      return { ...state, streaming: false };
    case 'tool': {
      const existing = state.toolCalls.find((t) => t.name === action.name && t.status === 'running');
      if (existing && action.status === 'done') {
        return {
          ...state,
          toolCalls: state.toolCalls.map((t) => (t === existing ? { ...t, status: 'done', output: action.output } : t)),
        };
      }
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          { id: `${Date.now()}-${Math.random()}`, name: action.name, input: action.input, status: action.status, output: action.output },
        ],
      };
    }
    case 'error':
      return { ...state, streaming: false };
  }
}

export function useThreadState() {
  const [state, dispatch] = useReducer(reducer, initial);
  return {
    state,
    setMessages: useCallback((m: ControlMessageRow[]) => dispatch({ type: 'set', messages: m }), []),
    addUser: useCallback((c: string) => dispatch({ type: 'add-user', content: c }), []),
    startAssistant: useCallback(() => dispatch({ type: 'start-assistant' }), []),
    appendAssistant: useCallback((c: string) => dispatch({ type: 'append-assistant', chunk: c }), []),
    finishAssistant: useCallback(() => dispatch({ type: 'finish-assistant' }), []),
    addTool: useCallback(
      (name: string, status: 'running' | 'done', input?: string, output?: string) =>
        dispatch({ type: 'tool', name, status, input, output }),
      [],
    ),
  };
}
```

- [ ] **Step 2: Message component**

`apps/control/renderer/components/Message.tsx`:
```tsx
import type { ControlMessageRow } from '../../src/server-types';

export function MessageView({ msg }: { msg: ControlMessageRow }) {
  const isUser = msg.role === 'user';
  const isTelegram = msg.source === 'telegram';
  return (
    <div className="px-4 py-3 border-b border-border/40 last:border-0">
      <header className="flex items-center gap-2 text-xs text-text-muted mb-1">
        <span className={isUser ? 'text-accent' : 'text-text'}>{isUser ? 'You' : 'Sean'}</span>
        {isTelegram && <span className="rounded-md bg-bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Telegram</span>}
        <span>· {new Date(msg.createdAt).toLocaleTimeString('nb-NO')}</span>
      </header>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-text">{msg.content}</pre>
    </div>
  );
}
```

- [ ] **Step 3: Composer component**

`apps/control/renderer/components/Composer.tsx`:
```tsx
'use client';
import { useState, useRef, useEffect } from 'react';

export interface ComposerProps {
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
}

export function Composer({ onSend, onAbort, streaming }: ComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && streaming) onAbort();
  }

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    onSend(t);
    setText('');
  }

  return (
    <div className="border-t border-border bg-bg-elev p-3">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={2}
        placeholder="Skriv en task… (Enter sender, Shift+Enter for ny linje)"
        className="w-full rounded-lg bg-bg-surface border border-border-strong px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-accent resize-none"
      />
      <div className="mt-2 flex justify-between text-xs text-text-muted">
        <span>{streaming ? 'Sean tenker… (Esc for å avbryte)' : 'Klar'}</span>
        <button
          onClick={streaming ? onAbort : submit}
          className={
            streaming
              ? 'rounded bg-danger px-3 py-1 text-text'
              : 'rounded bg-accent hover:bg-accent-hover px-3 py-1 text-text'
          }
        >
          {streaming ? 'Stopp' : 'Send ↑'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: ChatView component**

`apps/control/renderer/components/ChatView.tsx`:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { listMessages, sendMessageStream } from '../lib/api';
import { consumeSseResponse } from '../hooks/useSSE';
import { useThreadState } from '../state/thread';
import { MessageView } from './Message';
import { Composer } from './Composer';

export function ChatView({ controlSessionId }: { controlSessionId: string | null }) {
  const t = useThreadState();
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (controlSessionId) {
      listMessages(controlSessionId).then(t.setMessages).catch((e) => setError(String(e)));
    } else {
      t.setMessages([]);
    }
  }, [controlSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [t.state.messages.length]);

  async function send(text: string) {
    setError(null);
    t.addUser(text);
    t.startAssistant();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await sendMessageStream({ controlSessionId, text, signal: ac.signal });
      await consumeSseResponse(res, {
        onFrame: (f) => {
          if (f.event === 'partial') t.appendAssistant(f.data.text);
          else if (f.event === 'tool') t.addTool(f.data.name, f.data.status, f.data.input, f.data.output);
          else if (f.event === 'error') setError(f.data.message);
        },
        onStatus: (s) => { if (s.state === 'done' || s.state === 'error') t.finishAssistant(); },
      }, ac.signal);
    } catch (e) {
      setError(String((e as Error).message));
      t.finishAssistant();
    } finally {
      abortRef.current = null;
    }
  }

  function abort() { abortRef.current?.abort(); }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {t.state.messages.length === 0 && (
          <div className="p-8 text-center text-text-muted">Ingen meldinger ennå. Skriv noe nedenfor.</div>
        )}
        {t.state.messages.map((m) => <MessageView key={m.id} msg={m} />)}
        {error && <div className="px-4 py-2 text-sm text-danger">{error}</div>}
      </div>
      <Composer onSend={send} onAbort={abort} streaming={t.state.streaming} />
    </div>
  );
}
```

- [ ] **Step 5: Type-check**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/renderer/components apps/control/renderer/state
git commit -m "feat(renderer): ChatView with SSE streaming + thread state reducer"
```

---

### Task 21: ThreadList + main shell layout

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\ThreadList.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\Shell.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\StatusBar.tsx`
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\ThinkingPanel.tsx`
- Modify: `C:\Users\benja\nordrise-ai\apps\control\renderer\app\page.tsx`

- [ ] **Step 1: ThreadList**

`apps/control/renderer/components/ThreadList.tsx`:
```tsx
'use client';
import type { ControlSessionSummary } from '../../src/server-types';

export interface ThreadListProps {
  sessions: ControlSessionSummary[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
}

export function ThreadList({ sessions, activeId, onSelect, onNew }: ThreadListProps) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-bg-elev flex flex-col">
      <button
        onClick={onNew}
        className="m-3 rounded-lg bg-accent hover:bg-accent-hover py-2 text-sm font-medium"
      >
        + Ny tråd
      </button>
      <div className="px-3 pb-1 text-[11px] uppercase tracking-wider text-text-subtle">Desktop</div>
      <ul className="overflow-y-auto flex-1">
        {sessions.length === 0 && (
          <li className="px-3 py-2 text-sm text-text-muted">Ingen tråder ennå.</li>
        )}
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s.id)}
              className={`w-full text-left px-3 py-2 text-sm border-l-2 ${
                activeId === s.id
                  ? 'border-accent bg-bg-surface text-text'
                  : 'border-transparent text-text-muted hover:bg-bg-surface'
              }`}
            >
              <div className="truncate">{s.title ?? '(uten tittel)'}</div>
              <div className="text-[10px] text-text-subtle">
                {new Date(s.lastActiveAt).toLocaleString('nb-NO')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: ThinkingPanel (collapsible right rail)**

`apps/control/renderer/components/ThinkingPanel.tsx`:
```tsx
'use client';
import { useState } from 'react';

export interface ToolCall {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: 'running' | 'done';
}

export function ThinkingPanel({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [collapsed, setCollapsed] = useState(toolCalls.length === 0);
  if (collapsed) {
    return (
      <button
        className="w-8 border-l border-border text-xs text-text-muted hover:text-text"
        onClick={() => setCollapsed(false)}
      >
        ▶
      </button>
    );
  }
  return (
    <aside className="w-80 shrink-0 border-l border-border bg-bg-elev overflow-y-auto">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs uppercase tracking-wider text-text-subtle">Thinking</span>
        <button onClick={() => setCollapsed(true)} className="text-text-muted hover:text-text">×</button>
      </header>
      {toolCalls.length === 0 && <div className="p-3 text-sm text-text-muted">Ingen tool calls.</div>}
      {toolCalls.map((t) => (
        <div key={t.id} className="px-3 py-2 border-b border-border/40 text-xs">
          <div className={t.status === 'running' ? 'text-warn' : 'text-success'}>
            {t.status === 'running' ? '▶' : '✓'} {t.name}
          </div>
          {t.input && <pre className="mt-1 text-text-muted whitespace-pre-wrap break-words">{t.input}</pre>}
          {t.output && (
            <pre className="mt-1 text-text whitespace-pre-wrap break-words font-mono text-[11px]">
              {t.output.length > 400 ? t.output.slice(0, 400) + '…' : t.output}
            </pre>
          )}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 3: StatusBar**

`apps/control/renderer/components/StatusBar.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { pingHealthz } from '../lib/bridge';

export function StatusBar({ msgsLast5h }: { msgsLast5h: number }) {
  const [hz, setHz] = useState<{ status: number; body: any } | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await pingHealthz();
        if (!cancelled) setHz(r);
      } catch {
        if (!cancelled) setHz({ status: 0, body: null });
      }
    }
    tick();
    const t = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const ok = hz?.status === 200 && hz.body?.authMode === 'subscription' && hz.body?.db === 'ok';
  return (
    <footer className="border-t border-border bg-bg-elev px-3 py-1.5 text-xs text-text-muted flex items-center gap-3">
      <span className={ok ? 'text-success' : hz ? 'text-danger' : 'text-warn'}>
        ● {ok ? 'OK' : hz ? 'Feil' : 'Sjekker…'}
      </span>
      <span>Msgs siste 5h: {msgsLast5h}</span>
      <span className="ml-auto">Sean v1</span>
    </footer>
  );
}
```

- [ ] **Step 4: Shell**

`apps/control/renderer/components/Shell.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { listSessions, newSession } from '../lib/api';
import type { ControlSessionSummary } from '../../src/server-types';
import { ThreadList } from './ThreadList';
import { ChatView } from './ChatView';
import { ThinkingPanel } from './ThinkingPanel';
import { StatusBar } from './StatusBar';

export function Shell() {
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try { setSessions(await listSessions()); }
    catch (e) { setError(String(e)); }
  }

  useEffect(() => { refresh(); }, []);

  async function handleNew() {
    try {
      const s = await newSession();
      await refresh();
      setActiveId(s.id);
    } catch (e) { setError(String(e)); }
  }

  return (
    <div className="grid h-screen" style={{ gridTemplateRows: '1fr auto' }}>
      <div className="flex">
        <ThreadList sessions={sessions} activeId={activeId} onSelect={setActiveId} onNew={handleNew} />
        <main className="flex-1 min-w-0">
          {activeId ? (
            <ChatView key={activeId} controlSessionId={activeId} />
          ) : (
            <div className="grid h-full place-items-center text-text-muted">
              Velg en tråd eller klikk "+ Ny tråd"
            </div>
          )}
          {error && <div className="px-4 py-2 text-sm text-danger">{error}</div>}
        </main>
        <ThinkingPanel toolCalls={[]} />
      </div>
      <StatusBar msgsLast5h={0} />
    </div>
  );
}
```

- [ ] **Step 5: Wire Shell into `app/page.tsx`**

Replace the current `phase === 'app'` placeholder return with:
```tsx
return <Shell />;
```
And add at the top: `import { Shell } from '../components/Shell';`

- [ ] **Step 6: Run dev, verify end-to-end chat works**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run dev
```
- Onboarding → app
- Click "+ Ny tråd" → new session appears in left rail
- Type "hei" → Sean replies live, token-by-token
- Status bar shows green ●

- [ ] **Step 7: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/renderer
git commit -m "feat(renderer): Shell + ThreadList + ThinkingPanel + StatusBar (M3 chat works)"
```

---

### Task 22: Telegram-history view (read-only)

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\TelegramHistory.tsx`
- Modify: `ThreadList.tsx` (add Telegram section)

- [ ] **Step 1: TelegramHistory component**

`apps/control/renderer/components/TelegramHistory.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { listHistory } from '../lib/api';
import type { ControlMessageRow } from '../../src/server-types';
import { MessageView } from './Message';

export function TelegramHistory() {
  const [messages, setMessages] = useState<ControlMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listHistory('telegram', 200)
      .then((m) => setMessages(m.reverse()))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-2 text-xs uppercase text-text-subtle border-b border-border">Telegram (read-only)</div>
      {loading && <div className="p-4 text-text-muted">Laster…</div>}
      {!loading && messages.length === 0 && <div className="p-4 text-text-muted">Ingen Telegram-meldinger.</div>}
      {messages.map((m) => <MessageView key={m.id} msg={m} />)}
    </div>
  );
}
```

- [ ] **Step 2: Add Telegram section to ThreadList**

Add a `'telegram'` synthetic id. Modify `ThreadList.tsx` to accept a callback for selecting Telegram view:

In `Shell.tsx`, add a `view` state alongside `activeId`:
```tsx
type View = { kind: 'desktop'; id: string } | { kind: 'telegram' } | { kind: 'empty' };
const [view, setView] = useState<View>({ kind: 'empty' });
```
Replace the main switch:
```tsx
{view.kind === 'desktop' && <ChatView key={view.id} controlSessionId={view.id} />}
{view.kind === 'telegram' && <TelegramHistory />}
{view.kind === 'empty' && (<div className="grid h-full place-items-center text-text-muted">Velg en tråd</div>)}
```

In `ThreadList.tsx`, after the desktop list, add:
```tsx
<div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-text-subtle">Telegram</div>
<button
  onClick={onSelectTelegram}
  className={`w-full text-left px-3 py-2 text-sm border-l-2 ${
    activeKind === 'telegram'
      ? 'border-accent bg-bg-surface text-text'
      : 'border-transparent text-text-muted hover:bg-bg-surface'
  }`}
>
  Hele Telegram-historikken
</button>
```
Add new props:
```tsx
activeKind: 'desktop' | 'telegram' | 'empty';
onSelectTelegram: () => void;
```
Update `Shell.tsx` to pass `view.kind` and the appropriate handlers.

- [ ] **Step 3: Verify in dev**

`npm run dev` — clicking "Hele Telegram-historikken" loads your existing Telegram messages, marked with the Telegram badge.

- [ ] **Step 4: Commit**

```bash
git add apps/control/renderer
git commit -m "feat(renderer): Telegram history (read-only) view"
```

---

### Task 23: Type sync + CI client job

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\.github\workflows\ci.yml`

- [ ] **Step 1: Add `client` job to CI**

After the existing `build` job, add:
```yaml
  client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install root deps
        run: npm ci --no-audit --no-fund
      - name: Sync control types
        run: npm run sync-control-types
      - name: Install client deps
        working-directory: apps/control
        run: npm ci --no-audit --no-fund
      - name: Type-check client
        working-directory: apps/control
        run: npm run typecheck
      - name: Test client
        working-directory: apps/control
        run: npm test
      - name: Build renderer
        working-directory: apps/control
        run: npm run build:renderer
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add client job (typecheck + test + renderer build)"
```

---

### Task 24: Optimistic message persistence + reconnect-on-drop

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\ChatView.tsx`

- [ ] **Step 1: Refresh from server after stream completes**

After the `consumeSseResponse` call resolves, replace local optimistic messages with server truth:
```ts
// inside send(), after the consumeSseResponse await:
if (controlSessionId) {
  const truth = await listMessages(controlSessionId);
  t.setMessages(truth);
}
```

- [ ] **Step 2: Reconnect-on-drop logic**

Add a `useEffect` in `ChatView` that, on `error` SSE, schedules a refetch with backoff:
```ts
useEffect(() => {
  if (!error || !controlSessionId) return;
  const t1 = setTimeout(() => listMessages(controlSessionId).then((m) => t.setMessages(m)).catch(() => {}), 2000);
  return () => clearTimeout(t1);
}, [error, controlSessionId]);
```

- [ ] **Step 3: Verify by killing the dev backend mid-stream**

Start `npm run dev` for both backend and client; send a message; kill backend; the error appears, then 2s later messages refresh from cache. Restart backend; sending again works.

- [ ] **Step 4: Commit**

```bash
git add apps/control/renderer/components/ChatView.tsx
git commit -m "feat(renderer): refresh from server post-stream + reconnect backoff"
```

---

### Task 25: Apply server-side schema sync via type-sync pre-commit

**Files:**
- Create: `C:\Users\benja\nordrise-ai\.husky\pre-commit`
- Modify: `C:\Users\benja\nordrise-ai\package.json`

- [ ] **Step 1: Install husky**

```bash
cd /c/Users/benja/nordrise-ai
npm install --save-dev husky@9.1.7
npx husky init
```
This creates `.husky/pre-commit`.

- [ ] **Step 2: Edit `.husky/pre-commit`**

```bash
#!/usr/bin/env bash
set -e
npm run sync-control-types
git add apps/control/src/server-types.ts
```

- [ ] **Step 3: Test it**

Edit `src/api/control/types.ts` (add a comment), commit. Pre-commit should re-sync the file.

- [ ] **Step 4: Commit**

```bash
git add package.json .husky
git commit -m "chore: husky pre-commit syncs control types"
```

**M3 done — open PR.** Title: `feat: Sean Control v1 — M3 chat + streaming`.

---

# Milestone M4 — Drag&drop + quick-tasks + hotkeys (Tasks 26-32)

Goal: User can drop a file on the chat to attach it. Quick-task palette (Ctrl+K) lists, runs, and edits saved templates from local SQLite. Mini-popup (Ctrl+Shift+S) sends a quick task without opening the main window.

---

### Task 26: DropZone + upload integration

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\renderer\components\DropZone.tsx`
- Modify: `apps/control/renderer/lib/api.ts` (add `uploadFile`)
- Modify: `apps/control/renderer/components/ChatView.tsx`
- Modify: `apps/control/renderer/components/Composer.tsx`

- [ ] **Step 1: Add `uploadFile` to api.ts**

```ts
export async function uploadFile(file: File): Promise<{ fileId: string; workspacePath: string; filename: string; size: number }> {
  const [tok, base] = await Promise.all([getStoredToken(), getBackendUrl()]);
  if (!tok) throw new Error('no_token');
  const fd = new FormData();
  fd.append('file', file, file.name);
  const r = await fetch(`${base}/control/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: DropZone wrapper**

`apps/control/renderer/components/DropZone.tsx`:
```tsx
'use client';
import { useState, type ReactNode, type DragEvent } from 'react';

export interface DropZoneProps {
  children: ReactNode;
  onFiles: (files: File[]) => void;
}

export function DropZone({ children, onFiles }: DropZoneProps) {
  const [hovering, setHovering] = useState(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!hovering) setHovering(true);
  }
  function handleDragLeave(e: DragEvent) {
    if ((e.target as HTMLElement).classList.contains('dropzone-root')) setHovering(false);
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setHovering(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div
      className="dropzone-root relative h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {hovering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent/20 border-2 border-dashed border-accent z-50">
          <div className="text-2xl text-accent font-medium">📥 Slipp her for å legge ved</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Composer accepts attachments**

Modify `Composer.tsx` to accept `attachments` and an `onRemoveAttachment` prop. Show chips above textarea:
```tsx
export interface AttachmentChip {
  fileId: string;
  filename: string;
  workspacePath: string;
}

export interface ComposerProps {
  onSend: (text: string, attachments: AttachmentChip[]) => void;
  onAbort: () => void;
  streaming: boolean;
  attachments: AttachmentChip[];
  onRemoveAttachment: (fileId: string) => void;
}
```

In the JSX, before the textarea:
```tsx
{attachments.length > 0 && (
  <div className="mb-2 flex flex-wrap gap-2">
    {attachments.map((a) => (
      <span key={a.fileId} className="flex items-center gap-2 rounded bg-bg-surface px-2 py-1 text-xs">
        📎 {a.filename}
        <button onClick={() => onRemoveAttachment(a.fileId)} className="text-text-muted hover:text-danger">×</button>
      </span>
    ))}
  </div>
)}
```

Update `submit()` to call `onSend(t, attachments)`.

- [ ] **Step 4: Wire ChatView**

In `ChatView.tsx`:
```tsx
import { DropZone } from './DropZone';
import { uploadFile } from '../lib/api';
// ...
const [attachments, setAttachments] = useState<AttachmentChip[]>([]);

async function onFiles(files: File[]) {
  for (const f of files) {
    try {
      const up = await uploadFile(f);
      setAttachments((a) => [...a, { fileId: up.fileId, filename: up.filename, workspacePath: up.workspacePath }]);
    } catch (e) {
      setError(`Upload feilet: ${(e as Error).message}`);
    }
  }
}

// modify send signature:
async function send(text: string, atts: AttachmentChip[]) {
  // ... pass attachments to sendMessageStream
  const res = await sendMessageStream({
    controlSessionId,
    text,
    attachments: atts.map((a) => ({ fileId: a.fileId, workspacePath: a.workspacePath, filename: a.filename })),
    signal: ac.signal,
  });
  setAttachments([]);
  // ... rest unchanged
}
```

Wrap the return in `<DropZone onFiles={onFiles}>...</DropZone>` and pass `attachments` + `onRemoveAttachment` into `Composer`.

- [ ] **Step 5: Verify in dev**

Start dev. Drop a small text file onto the chat. See attachment chip. Send. Sean responds with awareness of the file path.

- [ ] **Step 6: Commit**

```bash
git add apps/control/renderer
git commit -m "feat(renderer): drag&drop file uploads + composer attachments"
```

---

### Task 27: better-sqlite3 quick-task store

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\store.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\main\store.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/control/main/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QuickTaskStore } from './store.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qts-')); });

describe('QuickTaskStore', () => {
  it('creates and lists', () => {
    const s = new QuickTaskStore(join(dir, 'data.db'));
    s.create({ title: 'Skriv ukerapport', emoji: '📊', template: 'Skriv ukerapport for {{kunde}}', variables: [{ name: 'kunde', prompt: 'Kunde?', default: 'Happy Time' }], attachClipboard: false });
    s.create({ title: 'Sjekk deploy', emoji: '🚀', template: 'Sjekk Railway deploy-status', variables: [], attachClipboard: false });
    const all = s.list();
    expect(all).toHaveLength(2);
    expect(all[0]?.title).toBe('Sjekk deploy'); // newest first
  });
  it('updates and deletes', () => {
    const s = new QuickTaskStore(join(dir, 'data.db'));
    const id = s.create({ title: 'A', emoji: '⚡', template: 't', variables: [], attachClipboard: false });
    s.update(id, { title: 'B' });
    expect(s.get(id)?.title).toBe('B');
    s.delete(id);
    expect(s.get(id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm test -- main/store.test.ts
```

- [ ] **Step 3: Implement**

`apps/control/main/store.ts`:
```ts
import Database from 'better-sqlite3';
import { createId } from '@paralleldrive/cuid2';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface QuickTaskVariable {
  name: string;
  prompt: string;
  default?: string;
}

export interface QuickTask {
  id: string;
  title: string;
  emoji: string;
  template: string;
  variables: QuickTaskVariable[];
  attachClipboard: boolean;
  hotkey?: string;
  createdAt: number;
  updatedAt: number;
}

export type QuickTaskInput = Omit<QuickTask, 'id' | 'createdAt' | 'updatedAt'>;

export class QuickTaskStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        emoji TEXT NOT NULL,
        template TEXT NOT NULL,
        variables_json TEXT NOT NULL,
        attach_clipboard INTEGER NOT NULL DEFAULT 0,
        hotkey TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  list(): QuickTask[] {
    const rows = this.db.prepare('SELECT * FROM quick_tasks ORDER BY updated_at DESC').all() as any[];
    return rows.map(this.fromRow);
  }

  get(id: string): QuickTask | null {
    const row = this.db.prepare('SELECT * FROM quick_tasks WHERE id = ?').get(id) as any;
    return row ? this.fromRow(row) : null;
  }

  create(input: QuickTaskInput): string {
    const id = createId();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO quick_tasks (id, title, emoji, template, variables_json, attach_clipboard, hotkey, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.title, input.emoji, input.template,
      JSON.stringify(input.variables ?? []),
      input.attachClipboard ? 1 : 0,
      input.hotkey ?? null,
      now, now,
    );
    return id;
  }

  update(id: string, patch: Partial<QuickTaskInput>): void {
    const cur = this.get(id);
    if (!cur) throw new Error('not_found');
    const merged = { ...cur, ...patch };
    this.db.prepare(`
      UPDATE quick_tasks SET title=?, emoji=?, template=?, variables_json=?, attach_clipboard=?, hotkey=?, updated_at=?
      WHERE id = ?
    `).run(
      merged.title, merged.emoji, merged.template,
      JSON.stringify(merged.variables ?? []),
      merged.attachClipboard ? 1 : 0,
      merged.hotkey ?? null,
      Date.now(), id,
    );
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM quick_tasks WHERE id = ?').run(id);
  }

  private fromRow(row: any): QuickTask {
    return {
      id: row.id,
      title: row.title,
      emoji: row.emoji,
      template: row.template,
      variables: JSON.parse(row.variables_json),
      attachClipboard: !!row.attach_clipboard,
      hotkey: row.hotkey ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
```

- [ ] **Step 4: Install cuid2 in apps/control**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm install @paralleldrive/cuid2@2.2.2
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npm test -- main/store.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/main/store.ts apps/control/main/store.test.ts apps/control/package.json apps/control/package-lock.json
git commit -m "feat(control): better-sqlite3 quick-task store with CRUD"
```

---

### Task 28: Quick-task IPC + variable substitution

**Files:**
- Modify: `apps/control/main/ipc.ts`
- Modify: `apps/control/main/index.ts`
- Create: `apps/control/renderer/lib/quickTasks.ts`
- Create: `apps/control/main/template.ts`
- Create: `apps/control/main/template.test.ts`

- [ ] **Step 1: Template substitution helpers (test-first)**

`apps/control/main/template.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { collectVariables, substitute } from './template.js';

describe('template', () => {
  it('collects {{var}} occurrences', () => {
    expect(collectVariables('hi {{a}} and {{b}} and {{a}}')).toEqual(['a', 'b']);
  });
  it('substitutes vars', () => {
    expect(substitute('Hi {{name}}!', { name: 'Sean' })).toBe('Hi Sean!');
  });
  it('leaves missing vars as empty string', () => {
    expect(substitute('Hi {{name}}!', {})).toBe('Hi !');
  });
});
```

`apps/control/main/template.ts`:
```ts
const VAR_RE = /{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g;

export function collectVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) seen.add(m[1]!);
  return [...seen];
}

export function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(VAR_RE, (_full, name) => (vars[name] ?? ''));
}
```

Run tests:
```bash
npm test -- main/template.test.ts
```

- [ ] **Step 2: Add IPC handlers**

In `apps/control/main/ipc.ts`, add:
```ts
import { app } from 'electron';
import { join } from 'node:path';
import { QuickTaskStore, type QuickTaskInput } from './store.js';

let store: QuickTaskStore | null = null;
function getStore() {
  if (!store) store = new QuickTaskStore(join(app.getPath('userData'), 'data.db'));
  return store;
}

// Inside registerIpc():
ipcMain.handle('qt:list', () => getStore().list());
ipcMain.handle('qt:get', (_e, id: string) => getStore().get(id));
ipcMain.handle('qt:create', (_e, input: QuickTaskInput) => getStore().create(input));
ipcMain.handle('qt:update', (_e, payload: { id: string; patch: Partial<QuickTaskInput> }) => getStore().update(payload.id, payload.patch));
ipcMain.handle('qt:delete', (_e, id: string) => getStore().delete(id));
```

- [ ] **Step 3: Renderer wrapper**

`apps/control/renderer/lib/quickTasks.ts`:
```ts
import type { QuickTask, QuickTaskInput } from '../../main/store';

export const qt = {
  list: () => window.nordrise.invoke<QuickTask[]>('qt:list'),
  get: (id: string) => window.nordrise.invoke<QuickTask | null>('qt:get', id),
  create: (input: QuickTaskInput) => window.nordrise.invoke<string>('qt:create', input),
  update: (id: string, patch: Partial<QuickTaskInput>) => window.nordrise.invoke<void>('qt:update', { id, patch }),
  delete: (id: string) => window.nordrise.invoke<void>('qt:delete', id),
};
```

- [ ] **Step 4: Commit**

```bash
git add apps/control/main apps/control/renderer/lib/quickTasks.ts
git commit -m "feat(control): quick-task IPC + variable substitution"
```

---

### Task 29: QuickTaskPalette + variable prompt modal

**Files:**
- Create: `apps/control/renderer/components/QuickTaskPalette.tsx`
- Create: `apps/control/renderer/components/VariablePrompt.tsx`
- Modify: `apps/control/renderer/components/Shell.tsx` (add Ctrl+K handler)

- [ ] **Step 1: VariablePrompt modal**

`apps/control/renderer/components/VariablePrompt.tsx`:
```tsx
'use client';
import { useState } from 'react';
import type { QuickTaskVariable } from '../../main/store';

export function VariablePrompt({
  variables, onConfirm, onCancel,
}: {
  variables: QuickTaskVariable[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(variables.map((v) => [v.name, v.default ?? ''])),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(vals);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50">
      <form onSubmit={submit} className="w-[480px] rounded-2xl border border-border bg-bg-elev p-6">
        <h2 className="text-lg font-semibold mb-4">Variabler</h2>
        {variables.map((v) => (
          <label key={v.name} className="block mb-3">
            <span className="text-xs text-text-muted">{v.prompt}</span>
            <input
              autoFocus={v === variables[0]}
              value={vals[v.name] ?? ''}
              onChange={(e) => setVals({ ...vals, [v.name]: e.target.value })}
              className="mt-1 w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm"
            />
          </label>
        ))}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onCancel} className="px-3 py-1 text-sm text-text-muted">Avbryt</button>
          <button type="submit" className="rounded bg-accent hover:bg-accent-hover px-3 py-1 text-sm">Kjør</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: QuickTaskPalette**

`apps/control/renderer/components/QuickTaskPalette.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { qt } from '../lib/quickTasks';
import type { QuickTask } from '../../main/store';
import { VariablePrompt } from './VariablePrompt';

export function QuickTaskPalette({
  onPick, onClose, onManage,
}: {
  onPick: (finalText: string) => void;
  onClose: () => void;
  onManage: () => void;
}) {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<QuickTask | null>(null);

  useEffect(() => { qt.list().then(setTasks); }, []);

  const filtered = filter
    ? tasks.filter((t) => t.title.toLowerCase().includes(filter.toLowerCase()))
    : tasks;

  function pick(task: QuickTask) {
    if (task.variables.length === 0) {
      onPick(task.template);
    } else {
      setPending(task);
    }
  }

  if (pending) {
    return (
      <VariablePrompt
        variables={pending.variables}
        onConfirm={(vals) => {
          const out = pending.template.replace(/{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}/g, (_f, n) => vals[n] ?? '');
          onPick(out);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-start bg-black/50 pt-[15vh]" onClick={onClose}>
      <div className="w-[600px] mx-auto rounded-2xl border border-border bg-bg-elev shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="🔍 Søk eller velg quick-task…"
          className="w-full bg-transparent border-b border-border px-4 py-3 text-sm focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && filtered[0]) pick(filtered[0]);
          }}
        />
        <ul className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 && <li className="px-4 py-3 text-text-muted text-sm">Ingen treff.</li>}
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => pick(t)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-bg-surface flex items-center gap-3"
              >
                <span className="text-lg">{t.emoji}</span>
                <span>{t.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <footer className="border-t border-border px-4 py-2 text-xs flex justify-between">
          <button className="text-text-muted hover:text-text" onClick={onManage}>+ Administrer quick-tasks</button>
          <span className="text-text-subtle">Esc lukker</span>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire Ctrl+K + palette into Shell**

In `Shell.tsx`:
```tsx
import { QuickTaskPalette } from './QuickTaskPalette';
// ...
const [paletteOpen, setPaletteOpen] = useState(false);
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true); }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
// ...
{paletteOpen && (
  <QuickTaskPalette
    onPick={(text) => { setPaletteOpen(false); /* dispatch send to ChatView via ref or shared state */ }}
    onClose={() => setPaletteOpen(false)}
    onManage={() => { setPaletteOpen(false); /* navigate to /quick-tasks page */ }}
  />
)}
```

To dispatch the picked text into ChatView, add a `pendingSend` state to `Shell` and pass into `ChatView` as a prop that triggers a useEffect to send it.

In `ChatView`, add:
```tsx
useEffect(() => {
  if (pendingSend) {
    send(pendingSend, attachments);
    onSendConsumed();
  }
}, [pendingSend]);
```

Plumb `pendingSend` and `onSendConsumed` through props.

- [ ] **Step 4: Verify**

`npm run dev`. Press Ctrl+K. Palette opens. Create one quick-task via the manage page (next task). Pick it. ChatView sends.

- [ ] **Step 5: Commit**

```bash
git add apps/control/renderer
git commit -m "feat(renderer): quick-task palette + variable prompt modal (Ctrl+K)"
```

---

### Task 30: Quick-task management page

**Files:**
- Create: `apps/control/renderer/app/quick-tasks/page.tsx`
- Modify: `apps/control/renderer/components/Shell.tsx`

- [ ] **Step 1: Page**

`apps/control/renderer/app/quick-tasks/page.tsx`:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { qt } from '../../lib/quickTasks';
import type { QuickTask } from '../../../main/store';

export default function QuickTasksPage() {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [editing, setEditing] = useState<Partial<QuickTask> | null>(null);

  async function refresh() { setTasks(await qt.list()); }
  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!editing) return;
    const input = {
      title: editing.title ?? '',
      emoji: editing.emoji ?? '⚡',
      template: editing.template ?? '',
      variables: editing.variables ?? [],
      attachClipboard: !!editing.attachClipboard,
      hotkey: editing.hotkey,
    };
    if (editing.id) await qt.update(editing.id, input);
    else await qt.create(input);
    setEditing(null);
    await refresh();
  }

  return (
    <main className="h-screen overflow-y-auto bg-bg p-6 text-text">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Quick-tasks</h1>
        <button onClick={() => setEditing({})} className="rounded bg-accent hover:bg-accent-hover px-3 py-1.5 text-sm">+ Ny</button>
      </header>

      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-bg-elev px-4 py-2">
            <span className="text-xl">{t.emoji}</span>
            <span className="flex-1">{t.title}</span>
            <button onClick={() => setEditing(t)} className="text-text-muted hover:text-text text-sm">Rediger</button>
            <button onClick={async () => { await qt.delete(t.id); refresh(); }} className="text-danger hover:text-text text-sm">Slett</button>
          </li>
        ))}
      </ul>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50">
          <div className="w-[560px] rounded-2xl border border-border bg-bg-elev p-6">
            <h2 className="text-lg font-semibold mb-4">{editing.id ? 'Rediger' : 'Ny'} quick-task</h2>
            <label className="block mb-3 text-xs text-text-muted">
              Tittel
              <input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="mt-1 w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm" />
            </label>
            <label className="block mb-3 text-xs text-text-muted">
              Emoji
              <input value={editing.emoji ?? '⚡'} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} className="mt-1 w-20 rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm" />
            </label>
            <label className="block mb-3 text-xs text-text-muted">
              Template (bruk {'{{'}var{'}}'} for variabler)
              <textarea value={editing.template ?? ''} onChange={(e) => setEditing({ ...editing, template: e.target.value })} rows={5} className="mt-1 w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm font-mono" />
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="px-3 py-1 text-sm text-text-muted">Avbryt</button>
              <button onClick={save} className="rounded bg-accent hover:bg-accent-hover px-3 py-1 text-sm">Lagre</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Variable editor (deferred or inline)**

For v1, the template UI lets you write `{{var}}` placeholders. Variable prompts are auto-generated at run-time from `collectVariables` (the palette already handles this if we extend it):

In `QuickTaskPalette.tsx`'s `pick` function, replace the variables check with:
```ts
import { collectVariables } from '../../main/template';
// ...
const varNames = collectVariables(task.template);
if (varNames.length === 0) {
  onPick(task.template);
} else {
  setPending({ ...task, variables: varNames.map((n) => ({ name: n, prompt: n + '?' })) });
}
```

(For v1 we don't surface explicit variable metadata in the editor — variables are auto-detected. Variable metadata in `QuickTask` exists for future use.)

- [ ] **Step 3: Commit**

```bash
git add apps/control/renderer
git commit -m "feat(renderer): quick-task management page + auto-variable detection"
```

---

### Task 31: Mini-popup window

**Files:**
- Create: `apps/control/renderer/app/popup/page.tsx`
- Modify: `apps/control/main/index.ts`
- Modify: `apps/control/main/ipc.ts`

- [ ] **Step 1: Popup page**

`apps/control/renderer/app/popup/page.tsx`:
```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { sendMessageStream } from '../../lib/api';

export default function PopupPage() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await sendMessageStream({ controlSessionId: null, text: t });
      // Fire-and-forget; user gets result via toast (next task).
      window.nordrise.invoke('popup:done', { text: t });
    } finally {
      setBusy(false);
      setText('');
      window.nordrise.invoke('popup:close');
    }
  }

  return (
    <main className="h-screen bg-bg-elev p-3 grid place-items-center">
      <form onSubmit={submit} className="w-full">
        <div className="flex items-center gap-2 px-1 mb-1 text-xs text-text-muted">
          <span>⚡ Sean</span>
          <button
            type="button"
            onClick={() => window.nordrise.invoke('popup:close')}
            className="ml-auto text-text-muted hover:text-text"
          >×</button>
        </div>
        <div className="flex gap-2">
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') window.nordrise.invoke('popup:close'); }}
            placeholder="Skriv en quick task…"
            disabled={busy}
            className="flex-1 rounded-lg bg-bg-surface border border-border-strong px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy} className="rounded bg-accent hover:bg-accent-hover px-4 disabled:opacity-50">↑</button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Main-process popup window manager**

In `apps/control/main/index.ts`:
```ts
import { miniPopupWindowOptions } from './windows.js';

let popupWin: BrowserWindow | null = null;

export function showPopup(): void {
  if (popupWin) { popupWin.show(); popupWin.focus(); return; }
  popupWin = new BrowserWindow(miniPopupWindowOptions(preloadPath()));
  const url = process.env.NODE_ENV === 'development'
    ? 'http://localhost:4001/popup'
    : `file://${join(__dirname, '..', 'renderer', 'popup', 'index.html')}`;
  void popupWin.loadURL(url);
  popupWin.once('ready-to-show', () => popupWin?.show());
  popupWin.on('blur', () => popupWin?.hide());
  popupWin.on('closed', () => { popupWin = null; });
}

export function hidePopup(): void {
  popupWin?.hide();
}
```

- [ ] **Step 3: IPC handlers for popup**

In `apps/control/main/ipc.ts`:
```ts
import { showPopup, hidePopup } from './index.js'; // beware of circular import — actually move popup helpers to separate file `popup.ts`
```

To avoid circular imports, create `apps/control/main/popup.ts` and move `popupWin`, `showPopup`, `hidePopup` there. Then in `ipc.ts`:
```ts
import { hidePopup } from './popup.js';
ipcMain.handle('popup:close', () => hidePopup());
ipcMain.handle('popup:done', () => { /* hook for toast in next task */ });
```

- [ ] **Step 4: Verify**

`npm run dev`. From DevTools console (in main window) call `window.nordrise.invoke('popup:show')` — well, we don't have that yet. Hotkeys task adds the trigger. For now just make sure the popup page renders standalone at `http://localhost:4001/popup`.

- [ ] **Step 5: Commit**

```bash
git add apps/control
git commit -m "feat(electron): mini-popup window + popup page"
```

---

### Task 32: Global hotkeys + tray hotkey wiring

**Files:**
- Create: `apps/control/main/hotkeys.ts`
- Modify: `apps/control/main/index.ts`
- Modify: `apps/control/main/tray.ts`

- [ ] **Step 1: hotkeys.ts**

```ts
import { globalShortcut, BrowserWindow, Notification } from 'electron';
import { showPopup } from './popup.js';
import { logger } from './logger.js';

export interface HotkeyDeps {
  getMainWindow: () => BrowserWindow | null;
}

export function registerHotkeys(deps: HotkeyDeps): void {
  const ok1 = globalShortcut.register('Control+Shift+S', () => showPopup());
  const ok2 = globalShortcut.register('Control+Shift+L', () => {
    const w = deps.getMainWindow();
    if (w) { w.show(); w.focus(); }
  });

  if (!ok1 || !ok2) {
    new Notification({ title: 'Nordrise Control', body: 'Hurtigtaster ble blokkert (taster i bruk).' }).show();
  }
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
```

For logger, create `apps/control/main/logger.ts`:
```ts
const ts = () => new Date().toISOString();
export const logger = {
  info: (...a: unknown[]) => console.log(`[${ts()}] info`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${ts()}] warn`, ...a),
  error: (...a: unknown[]) => console.error(`[${ts()}] error`, ...a),
};
```

- [ ] **Step 2: Wire hotkeys into main**

In `apps/control/main/index.ts`:
```ts
import { registerHotkeys, unregisterHotkeys } from './hotkeys.js';
// ...
app.whenReady().then(async () => {
  registerIpc();
  await createMainWindow();
  initTray(() => mainWin);
  registerHotkeys({ getMainWindow: () => mainWin });
  // ... healthz interval
});
app.on('will-quit', () => unregisterHotkeys());
```

- [ ] **Step 3: Toast on assistant reply (popup follow-up)**

In `messageRoute.ts` send the result back over IPC, but since the popup runs renderer code and there's no main-side bridge, do the simple thing: when popup posts via `popup:done`, schedule a delayed re-fetch and show a Notification when the latest desktop session has a new assistant message.

For v1 minimal: in `popup:done` handler in `ipc.ts`:
```ts
ipcMain.handle('popup:done', async (_e, payload: { text: string }) => {
  // Wait briefly, then poll for the most recent assistant message
  setTimeout(async () => {
    try {
      const url = process.env.NORDRISE_BACKEND_URL ?? 'https://sean-production-4fcf.up.railway.app';
      const tok = await getToken();
      if (!tok) return;
      // Get the most-recent session, then its messages
      const r1 = await fetch(`${url}/control/sessions`, { headers: { Authorization: `Bearer ${tok}` } });
      const j1 = await r1.json();
      const sid = j1.sessions[0]?.id;
      if (!sid) return;
      const r2 = await fetch(`${url}/control/sessions/${sid}/messages`, { headers: { Authorization: `Bearer ${tok}` } });
      const j2 = await r2.json();
      const last = j2.messages[j2.messages.length - 1];
      if (last && last.role === 'assistant') {
        new Notification({
          title: 'Sean svarte',
          body: last.content.slice(0, 200),
        }).show();
      }
    } catch (err) {
      logger.warn('popup:done poll failed', err);
    }
  }, 5_000);
});
```

(This is best-effort. v3 will add an event-driven version.)

- [ ] **Step 4: Verify**

`npm run dev`. Press Ctrl+Shift+S. Mini-popup appears. Type "hei" → Enter. Popup closes. ~5s later, native Windows toast appears with Sean's reply.

- [ ] **Step 5: Commit**

```bash
git add apps/control/main
git commit -m "feat(electron): global hotkeys (Ctrl+Shift+S/L) + reply toast"
```

**M4 done — open PR.** Title: `feat: Sean Control v1 — M4 attachments + quick-tasks + hotkeys`.

---

# Milestone M5 — Installer + release (Tasks 33-37)

Goal: `Nordrise Installer.exe` exists, signed-or-not, downloadable from GitHub Releases. Auto-updates pull from the same Releases page on startup.

---

### Task 33: electron-builder config

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\electron-builder.yml`
- Create: `C:\Users\benja\nordrise-ai\apps\installer\assets\nordrise-icon.ico` (optional, see step 4)
- Create: `C:\Users\benja\nordrise-ai\apps\installer\assets\installer-banner.bmp` (optional)

- [ ] **Step 1: electron-builder.yml**

`apps/control/electron-builder.yml`:
```yaml
appId: tech.bennyk.nordrise.control
productName: Nordrise Control
artifactName: "Nordrise Installer.${ext}"
copyright: "© 2026 Benjamin Nicolai Kleiven / Nordrise"

directories:
  output: release
  buildResources: ../installer/assets

files:
  - dist/**/*
  - "!**/*.map"
  - package.json

extraResources:
  - from: dist/assets
    to: assets

asar: true
compression: maximum

win:
  target:
    - target: nsis
      arch: [x64]
  icon: ../installer/assets/nordrise-icon.ico
  publisherName: "Nordrise"

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  installerIcon: ../installer/assets/nordrise-icon.ico
  uninstallerIcon: ../installer/assets/nordrise-icon.ico
  installerHeaderIcon: ../installer/assets/nordrise-icon.ico
  deleteAppDataOnUninstall: false
  shortcutName: "Nordrise Control"
  createDesktopShortcut: true
  createStartMenuShortcut: true
  include: ../installer/nordrise-installer.nsh

publish:
  - provider: github
    owner: bennyk-tech
    repo: nordrise-ai
    releaseType: release
```

- [ ] **Step 2: Create installer assets**

Easiest: skip custom icon for now and let electron-builder use the default. Better: any 256×256 .ico file at `apps/installer/assets/nordrise-icon.ico`. Convert a Nordrise logo PNG with `magick logo.png -define icon:auto-resize=16,32,48,64,128,256 nordrise-icon.ico`.

- [ ] **Step 3: Custom NSIS script (optional Nordrise branding)**

`apps/installer/nordrise-installer.nsh`:
```nsis
!macro customHeader
  RequestExecutionLevel user
!macroend

!macro customWelcomePage
  ; Default welcome is fine; placeholder for future Nordrise hero
!macroend

!macro customInstall
  DetailPrint "Installerer Nordrise Control…"
!macroend
```

- [ ] **Step 4: Test packaging (no signing yet)**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run build
npm run package:dir   # produces dist-style folder, no .exe yet
npm run package        # produces release/Nordrise Installer.exe
```
Expected: `apps/control/release/Nordrise Installer.exe` exists. SmartScreen will warn on first run (acceptable for v1).

- [ ] **Step 5: Smoke-test the installer**

Run `Nordrise Installer.exe` on your machine. Click through. App should launch from Start menu. Onboarding works against prod backend.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/electron-builder.yml apps/installer
git commit -m "feat(installer): electron-builder + NSIS Nordrise Installer config"
```

---

### Task 34: Auto-update via electron-updater

**Files:**
- Create: `apps/control/main/autoUpdate.ts`
- Modify: `apps/control/main/index.ts`

- [ ] **Step 1: autoUpdate.ts**

```ts
import { autoUpdater } from 'electron-updater';
import { dialog } from 'electron';
import { logger } from './logger.js';

export function initAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => logger.warn('autoUpdate error', err));
  autoUpdater.on('update-available', (info) => logger.info('update available', info.version));
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart nå', 'Senere'],
      defaultId: 0,
      title: 'Nordrise Control oppdatering',
      message: 'En ny versjon er lastet ned. Restart for å installere.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  void autoUpdater.checkForUpdatesAndNotify();
}
```

- [ ] **Step 2: Wire into main**

In `app.whenReady`:
```ts
import { initAutoUpdate } from './autoUpdate.js';
// ...
if (app.isPackaged) initAutoUpdate();
```

- [ ] **Step 3: Build, ensure no error in dev**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/control/main
git commit -m "feat(electron): auto-update via electron-updater (GitHub Releases)"
```

---

### Task 35: GitHub Releases workflow (release on tag)

**Files:**
- Create: `C:\Users\benja\nordrise-ai\.github\workflows\release-control.yml`

- [ ] **Step 1: Workflow**

```yaml
name: Release control client

on:
  push:
    tags: ['control-v*']

jobs:
  release:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install root deps + sync types
        run: |
          npm ci --no-audit --no-fund
          npm run sync-control-types

      - name: Install client deps
        working-directory: apps/control
        run: npm ci --no-audit --no-fund

      - name: Build client
        working-directory: apps/control
        run: npm run build

      - name: Package + publish
        working-directory: apps/control
        run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Push your repo to GitHub** (if not already)

```bash
gh repo create bennyk-tech/nordrise-ai --private --source=/c/Users/benja/nordrise-ai --push --remote=origin
```
Or manually: create the repo on github.com, then:
```bash
git remote add origin https://github.com/bennyk-tech/nordrise-ai.git
git push -u origin main
```

- [ ] **Step 3: Tag and push**

```bash
# bump apps/control/package.json version to 0.1.0 first
cd /c/Users/benja/nordrise-ai
git tag control-v0.1.0
git push origin control-v0.1.0
```

- [ ] **Step 4: Verify GitHub Actions runs**

Check `https://github.com/bennyk-tech/nordrise-ai/actions`. The release workflow should produce `Nordrise Installer.exe` and a draft release. Publish the draft when satisfied.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-control.yml
git commit -m "ci: release control client on control-v* tags"
git push
```

---

### Task 36: Smoke-test on fresh Windows VM

**No new files; verification only.**

- [ ] **Step 1: Set up a clean Windows VM** (Hyper-V, Multipass, or just any other PC).

- [ ] **Step 2: Download `Nordrise Installer.exe`** from the GitHub Releases page.

- [ ] **Step 3: Run the installer**

Click through SmartScreen → "More info → Run anyway". Install. Launch from Start menu.

- [ ] **Step 4: Onboard with your prod control token**

Paste, click "Koble til Sean". App lands on the chat shell.

- [ ] **Step 5: Run through the full happy path**

- New thread → send "hei" → see streaming reply
- Drag a small text file → see attachment chip → send → Sean acknowledges
- Ctrl+K → palette appears (empty) → close
- Create one quick-task ("Sjekk Railway") via the manage page → trigger via palette
- Ctrl+Shift+S → mini-popup → send "hei" → close → toast appears with reply

- [ ] **Step 6: Capture issues**

If anything fails, file as a follow-up issue. Don't block the v1 release on every paper-cut.

- [ ] **Step 7: Mark M5 done**

No commit; this is verification.

---

### Task 37: Update release notes draft

- [ ] **Step 1: Edit the draft release on GitHub**

Title: `Nordrise Control v0.1.0 — first preview`

Body:
```markdown
## Hva er nytt
- Live chat med Sean fra Windows-PC, parallelt med Telegram
- Drag&drop fil-context (bilder, kode, PDF — opp til 25MB)
- Quick-tasks med Ctrl+K og global hurtigtast Ctrl+Shift+S for mini-popup
- Lese-only Telegram-historikk i samme UI
- Tray-ikon med live healthcheck-status

## Kjent
- Installer er ikke kodesignert ennå — Windows SmartScreen advarer første gang.
- Cost/usage-panel viser kun antall meldinger (ekte quota-math kommer i v3).
- Obsidian-integrasjon, routines og voice kommer i v2-v4.

## Installer
Last ned `Nordrise Installer.exe`. Klikk "More info" → "Run anyway" hvis SmartScreen advarer.
```

- [ ] **Step 2: Publish.**

---

# Milestone M6 — Polish & ship (Tasks 38-40)

---

### Task 38: Playwright E2E happy path

**Files:**
- Create: `C:\Users\benja\nordrise-ai\apps\control\e2e\happy-path.spec.ts`
- Create: `C:\Users\benja\nordrise-ai\apps\control\playwright.config.ts`
- Modify: `C:\Users\benja\nordrise-ai\apps\control\package.json`

- [ ] **Step 1: Install Playwright**

```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm install --save-dev @playwright/test@1.49.0
npx playwright install chromium
```

- [ ] **Step 2: Add `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { trace: 'on-first-retry' },
});
```

- [ ] **Step 3: E2E spec**

`apps/control/e2e/happy-path.spec.ts`:
```ts
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [join(__dirname, '..', 'dist', 'main', 'index.js')],
    env: {
      ...process.env,
      NORDRISE_BACKEND_URL: process.env.E2E_BACKEND_URL ?? 'http://localhost:3000',
    },
  });
});
test.afterAll(async () => { await app.close(); });

test('onboarding → new thread → send → assistant reply visible', async () => {
  const win = await app.firstWindow();
  await win.fill('input[type=password]', process.env.E2E_TOKEN ?? 'local-test-token');
  await win.click('button:has-text("Koble til Sean")');
  await win.waitForSelector('button:has-text("+ Ny tråd")');
  await win.click('button:has-text("+ Ny tråd")');
  await win.fill('textarea', 'hei');
  await win.press('textarea', 'Enter');
  await expect(win.locator('text=Sean')).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 4: Add npm script**

```json
"e2e": "playwright test"
```

- [ ] **Step 5: Run against a local backend**

Spin up local backend (Postgres + `npm run dev` at root with `CONTROL_API_TOKENS=local-test-token` and a real `CLAUDE_CODE_OAUTH_TOKEN`). Then:
```bash
cd /c/Users/benja/nordrise-ai/apps/control
npm run build
E2E_BACKEND_URL=http://localhost:3000 E2E_TOKEN=local-test-token npm run e2e
```
Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/benja/nordrise-ai
git add apps/control/e2e apps/control/playwright.config.ts apps/control/package.json apps/control/package-lock.json
git commit -m "test(e2e): Playwright happy-path for Electron app"
```

---

### Task 39: README + install guide

**Files:**
- Modify: `C:\Users\benja\nordrise-ai\README.md`
- Create: `C:\Users\benja\nordrise-ai\docs\install-control.md`

- [ ] **Step 1: Append to README.md**

Add a new section:
```markdown
## Nordrise Control (desktop client)

A Windows desktop app for talking to Sean from your PC, in addition to Telegram.

- Source: `apps/control/`
- Spec: `docs/superpowers/specs/2026-04-26-sean-control-v1-design.md`
- Plan: `docs/superpowers/plans/2026-04-26-sean-control-v1-implementation.md`
- Install: see `docs/install-control.md`
```

- [ ] **Step 2: Write `docs/install-control.md`**

```markdown
# Nordrise Control — install & first run

## 1. Issue a control token

```bash
npm run issue-control-token
```
Copy the printed hex string.

## 2. Add it to Railway

```bash
railway variables --set CONTROL_API_TOKENS="<existing>,<new-token>" --service sean
```
Wait ~30s for redeploy.

## 3. Install the app

Download `Nordrise Installer.exe` from
[GitHub Releases](https://github.com/bennyk-tech/nordrise-ai/releases).

Run it. SmartScreen will warn the first time — click "More info → Run anyway".

## 4. First-run onboarding

Paste the token from step 1 into the onboarding screen and click
"Koble til Sean". You should land on the chat shell with a green
status indicator at the bottom.

## 5. Hurtigtaster

- `Ctrl+Shift+S` — mini-popup for quick task
- `Ctrl+Shift+L` — focus main window
- `Ctrl+K` — quick-task palette (in main window)
- `Ctrl+N` — new thread
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/install-control.md
git commit -m "docs(control): install guide + README section"
```

---

### Task 40: Tag v0.1.0 + open final PR

- [ ] **Step 1: Bump version**

In `apps/control/package.json`:
```json
"version": "0.1.0"
```

- [ ] **Step 2: Update root version + commit**

```bash
git add apps/control/package.json
git commit -m "chore(control): bump to 0.1.0"
```

- [ ] **Step 3: Tag**

```bash
git tag control-v0.1.0
git push origin main control-v0.1.0
```

- [ ] **Step 4: GitHub Actions builds + publishes draft release**

Wait for the workflow to finish. Verify `Nordrise Installer.exe` is attached to the draft.

- [ ] **Step 5: Edit release notes (Task 37) + publish.**

- [ ] **Step 6: Open the v1 umbrella PR (or merge directly to main if you've been pushing to a branch)**

If you've been merging milestone-by-milestone, this may be redundant. Otherwise:
```bash
gh pr create --title "feat: Sean Control v1" --body "Implements docs/superpowers/specs/2026-04-26-sean-control-v1-design.md per docs/superpowers/plans/2026-04-26-sean-control-v1-implementation.md"
```

**v1 done. Ship it.**

---

# Self-Review

**Spec coverage check:**

| Spec section | Plan task(s) |
|---|---|
| 4.1 Component diagram | M1 backend (T2-T11), M2 client (T12-T18), M3 UI (T19-T22) |
| 4.2 Components — Electron main / preload / renderer / installer / Control API / ControlSessionManager | T14, T15, T16, T33, T8-T11, T5 |
| 4.3 Repo structure | T12 (sibling project), T2-T11 (backend dirs) |
| 4.4 Schema changes (ControlSession + Message nullable) | T4 |
| 5.1 Send-message flow | T8 (route) + T26 (upload) + T20 (renderer chat) |
| 5.2 SSE event protocol | T6 (stream helpers, types) |
| 5.3 Abort | T8 (req.on close), T20 (AbortController in ChatView) |
| 5.4 Timeout | T8 (uses existing `CLAUDE_CALL_TIMEOUT_MS`) |
| 5.5 Resume after disconnect | T24 (refresh from server post-stream + backoff) |
| 5.6 Telegram history | T9 (history route) + T22 (UI) |
| 6.1 Main window | T20 + T21 |
| 6.2 Mini-popup | T31 + T32 |
| 6.3 Tray icon | T18 + healthz interval in T18 |
| 6.4 Quick-task palette | T29 + T30 |
| 6.5 Drag&drop | T26 (DropZone + composer chips + upload) |
| 6.6 Global hotkeys | T32 |
| 7.1 Token model | T2 (issue script) + T17 (keytar) + T11 (Railway env) |
| 7.2 Backend validation | T3 (auth middleware) |
| 7.3 Threats — uploads | T10 (multer limits + magic-byte sniff + sanitization) |
| 7.3 Threats — SSE leak | T8 (req.on close) + T6 (heartbeat) |
| 7.4 Auth invariant | Untouched — verified in M1 deploy step |
| 8 Error handling | T8 (rate_limit/timeout/bridge_error events), T20 (UI rendering) |
| 9 Logging | T2-T11 (pino calls in routes), T32 (logger.ts client) |
| 10 Testing | T1 (vitest setup), T3-T10 (unit tests per route), T38 (E2E) |
| 11 Milestones | M1=T1-T11, M2=T12-T18, M3=T19-T25, M4=T26-T32, M5=T33-T37, M6=T38-T40 |
| 12 Risks | Mitigations baked in (heartbeat, keytar fallback, single-user assumption) |
| 13 YAGNI cuts | Respected — no Obsidian, no routines, no voice, no theme switch, no macOS |

**Placeholder scan:** No "TBD"/"TODO" sentences in steps. The few cases where I say "best-effort"/"v3 will add" are documented decisions, not placeholders.

**Type consistency check:**
- `ControlSessionSummary`/`ControlMessageRow`/`SseEvent` defined in T6 (`src/api/control/types.ts`), used by T9/T19/T20/T21/T22 — names consistent.
- `QuickTask`/`QuickTaskInput`/`QuickTaskVariable` defined in T27, used by T28/T29/T30 — consistent.
- `ControlMessageRequest` defined in T6, consumed by T8 — consistent.
- `AttachmentChip` defined in T26 — single source of truth for renderer.

**Scope check:** Plan implements exactly v1. No v2/v3/v4 work crept in.

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-sean-control-v1-implementation.md` (this file). Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for the long backend grind (M1) and the UI churn (M3-M4).

**2. Inline Execution** — Execute tasks in this session using executing-plans. Batch execution with checkpoints for review. Good if you want to follow along step-by-step.

**Which approach?**
