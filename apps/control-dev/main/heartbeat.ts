/**
 * heartbeat — Electron-aware daemon that ticks every 30 min when idle.
 *
 * Pure tick logic lives in `lib/heartbeat.ts`; this file owns the
 * Electron interactions: BrowserWindow focus check, vault read,
 * Notification dispatch, and the `heartbeat:status` broadcast.
 *
 * Per CLAUDE.md §15 the focus-check is load-bearing — pausing here
 * prevents two `claude -p` subprocesses from racing each other for the
 * Max-quota window when the user is mid-conversation.
 *
 * Per CLAUDE.md §16 the `HEARTBEAT_OK` sentinel comparison is strict:
 * exactly that string → silence; anything else → toast.
 *
 * NB: this file does not yet round-trip to Sean. The IPC layer carries
 * the prompt to a renderer-side helper that uses the existing
 * `control:stream-start` channel (the only place Bearer + per-user
 * Claude OAuth converge). See `Heartbeat: round-trip` TODO in
 * `phase3Ipc.ts` and `agent-self-test.ts` canary 3 (e2e-only).
 */
import { BrowserWindow, Notification } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import {
  HEARTBEAT_DEFAULT_INTERVAL_MS,
  buildHeartbeatPrompt,
  isHeartbeatOk,
} from './lib/heartbeat.js';
import { appendErrorLog } from './lib/robustness.js';

export type HeartbeatState = 'idle' | 'running' | 'paused';

export interface HeartbeatStatus {
  state: HeartbeatState;
  lastTickAt: number | null;
  nextTickAt: number | null;
  lastError: string | null;
}

interface HeartbeatDeps {
  /** Returns the current vault root (or null when unset). */
  getVaultPath: () => string | null;
  /** Returns the BrowserWindow we should pause for when focused. */
  getMainWindow: () => BrowserWindow | null;
  /** Round-trip Sean. Returns the assistant's reply text. */
  askSean: (prompt: string) => Promise<string>;
  /** Active project name for context, optional. */
  getActiveProjectName: () => string | null;
}

let timer: NodeJS.Timeout | null = null;
let intervalMs = HEARTBEAT_DEFAULT_INTERVAL_MS;
let status: HeartbeatStatus = {
  state: 'paused',
  lastTickAt: null,
  nextTickAt: null,
  lastError: null,
};
let deps: HeartbeatDeps | null = null;

function broadcast(): void {
  const payload = { ...status };
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('heartbeat:status', payload);
  }
}

function scheduleNextAt(): void {
  status.nextTickAt = Date.now() + intervalMs;
  broadcast();
}

async function readHeartbeatBody(vaultPath: string): Promise<string> {
  try {
    return await fs.readFile(join(vaultPath, 'Sean', 'HEARTBEAT.md'), 'utf8');
  } catch {
    return '';
  }
}

async function tick(): Promise<void> {
  if (!deps) return;
  if (status.state !== 'running') return;

  const win = deps.getMainWindow();
  if (win && !win.isDestroyed() && win.isFocused()) {
    // Focus pause (CLAUDE.md §15) — skip and reschedule.
    scheduleNextAt();
    return;
  }
  const vault = deps.getVaultPath();
  if (!vault) {
    scheduleNextAt();
    return;
  }
  const body = await readHeartbeatBody(vault);
  const prompt = buildHeartbeatPrompt(body, {
    projectName: deps.getActiveProjectName(),
    lastTickIso: status.lastTickAt ? new Date(status.lastTickAt).toISOString() : null,
  });

  status.lastTickAt = Date.now();
  status.lastError = null;
  broadcast();

  let reply = '';
  try {
    reply = (await deps.askSean(prompt)).trim();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    status.lastError = msg;
    await appendErrorLog(join(vault, 'Sean', 'errors.md'), {
      level: 'error',
      message: `[heartbeat] ${msg}`,
      stack: (err as Error).stack ?? '',
      context: { phase: 'tick', vault },
    }).catch(() => undefined);
    scheduleNextAt();
    return;
  }

  if (!isHeartbeatOk(reply)) {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Sean — heartbeat',
        body: reply.slice(0, 240),
        silent: false,
      });
      n.on('click', () => {
        const w = deps?.getMainWindow();
        if (w && !w.isDestroyed()) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
      });
      n.show();
    }
  }

  scheduleNextAt();
}

export function initHeartbeat(opts: HeartbeatDeps & { intervalMs?: number }): void {
  deps = opts;
  if (opts.intervalMs && opts.intervalMs >= 60_000) intervalMs = opts.intervalMs;
}

export function startHeartbeat(): HeartbeatStatus {
  if (status.state === 'running') return { ...status };
  status.state = 'running';
  scheduleNextAt();
  if (timer) clearInterval(timer);
  // Run-on-tick. The first tick fires after `intervalMs`, NOT
  // immediately, so the daemon never pre-empts a user task on app boot.
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return { ...status };
}

export function pauseHeartbeat(): HeartbeatStatus {
  status.state = 'paused';
  status.nextTickAt = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  broadcast();
  return { ...status };
}

export function getHeartbeatStatus(): HeartbeatStatus {
  return { ...status };
}

export async function tickNow(): Promise<HeartbeatStatus> {
  if (status.state !== 'running') startHeartbeat();
  await tick();
  return { ...status };
}

export function setHeartbeatInterval(ms: number): void {
  if (ms < 60_000) return;
  intervalMs = ms;
  if (status.state === 'running') {
    pauseHeartbeat();
    startHeartbeat();
  }
}
