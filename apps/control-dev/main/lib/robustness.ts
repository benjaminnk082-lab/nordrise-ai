/**
 * robustness — retry helper + Sentry-style local error log.
 *
 * Pure-Node module. The IPC layer wraps every channel handler with
 * `withErrorLogging` (a wrapper that catches, logs to errors.md, and
 * re-throws for the renderer) and uses `withRetry` around the
 * gateway-bound Electron `net.fetch` calls.
 */
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface RetryOpts {
  maxAttempts?: number;
  /** First-attempt delay in ms (0 means run immediately). */
  baseMs?: number;
  /** Multiplier between attempts (default 2 = exponential). */
  factor?: number;
  /** Cap on a single sleep, ms. */
  capMs?: number;
  /** Predicate: when it returns true the error is retried. Default: always true. */
  shouldRetry?: (err: unknown) => boolean;
  /** Hook so callers can log retry attempts (e.g. into errors.md). */
  onAttempt?: (info: { attempt: number; error: unknown; nextSleepMs: number }) => void;
}

/**
 * Run `fn` up to `maxAttempts` times with exponential backoff.
 * Resolves with the first successful return value; rejects with the
 * last error after exhaustion.
 *
 * The first attempt fires immediately (no initial sleep). Backoff sleeps
 * happen BETWEEN attempts: attempt-1 fail → sleep `baseMs` → attempt-2.
 * So with `baseMs=50, factor=2, maxAttempts=3`:
 *   t=0     attempt-1 (fails)
 *   t=50    attempt-2 (fails)
 *   t=150   attempt-3 (succeeds or final reject)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 1_000;
  const factor = opts.factor ?? 2;
  const capMs = opts.capMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err)) break;
      const sleep = Math.min(baseMs * factor ** (attempt - 1), capMs);
      opts.onAttempt?.({ attempt, error: err, nextSleepMs: sleep });
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
  throw lastErr;
}

export interface ErrorLogEntry {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  /** Captured automatically when omitted. */
  at?: string;
}

/**
 * Append a structured error to a Sentry-style markdown log file. Each
 * entry is one fenced JSON block with a header line, so the file stays
 * easy to read in Obsidian and grep-friendly from the CLI.
 *
 * Atomic-style: appends are serialised through a per-path mutex so
 * concurrent calls don't interleave their writes.
 */
const appendMutex = new Map<string, Promise<void>>();

export async function appendErrorLog(
  path: string,
  entry: ErrorLogEntry,
): Promise<void> {
  const at = entry.at ?? new Date().toISOString();
  const header = `## ${entry.level} — ${at}`;
  const summary = `**${entry.message.slice(0, 240)}**`;
  const blob = JSON.stringify(
    {
      at,
      level: entry.level,
      message: entry.message,
      stack: entry.stack,
      context: entry.context ?? {},
    },
    null,
    2,
  );
  const block = `${header}\n${summary}\n\n\`\`\`json\n${blob}\n\`\`\`\n\n`;

  const prev = appendMutex.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.appendFile(path, block, 'utf8');
    });
  appendMutex.set(path, next);
  return next;
}

/**
 * Wrap an async function so any thrown error is logged AND rethrown.
 * Use around IPC handlers so the renderer still gets the original
 * rejection while errors.md gets a record.
 */
export function withErrorLogging<TArgs extends unknown[], TRet>(
  errorLogPath: string,
  channelName: string,
  fn: (...args: TArgs) => Promise<TRet>,
): (...args: TArgs) => Promise<TRet> {
  return async (...args: TArgs): Promise<TRet> => {
    try {
      return await fn(...args);
    } catch (err) {
      const e = err as Error;
      await appendErrorLog(errorLogPath, {
        level: 'error',
        message: `[${channelName}] ${e.message ?? String(err)}`,
        stack: e.stack ?? '',
        context: { channel: channelName },
      }).catch(() => {
        // never let the logger itself crash the original error
      });
      throw err;
    }
  };
}
