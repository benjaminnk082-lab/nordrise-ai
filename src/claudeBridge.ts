/**
 * claudeBridge.ts
 *
 * Spawns `claude -p` as a subprocess, streams NDJSON, and returns
 * the final assistant reply plus the resolved session ID.
 *
 * - Never falls back to paid API: explicitly unsets ANTHROPIC_API_KEY on spawn.
 * - --resume <sessionId> if provided, otherwise a new session is created and
 *   the new id is captured from the first `system`/`init` event.
 * - Emits events so channels can show typing indicators while thinking.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { logger } from './logger.js';

export interface ClaudeBridgeResult {
  text: string;
  sessionId: string;
  durationMs: number;
  isError: boolean;
  errorMessage?: string;
  rateLimited: boolean;
  costUsd: number;
}

export interface ClaudeBridgeOptions {
  message: string;
  sessionId?: string | null;
  /**
   * Optional Claude model identifier passed as `--model` to the CLI.
   * Accepted values include the canonical names like `claude-opus-4-7`,
   * `claude-sonnet-4-6`, `claude-haiku-4-5`, or short aliases like `opus`.
   * When omitted the CLI uses its default.
   */
  model?: string;
  /**
   * Optional environment variables to inject into the spawned `claude` process.
   * Used by per-request connector keys (e.g. `FIRECRAWL_API_KEY`,
   * `GITHUB_PERSONAL_ACCESS_TOKEN`) that the user supplies in Settings on the
   * desktop client. Never persisted backend-side. `sanitizedEnv()` still
   * strips `ANTHROPIC_API_KEY` first; the user-supplied keys are merged on
   * top, so an attempt to set `ANTHROPIC_API_KEY` here would still be honored
   * — callers must not include it. Connector key names are well-known and
   * checked at the route layer.
   */
  env?: Record<string, string>;
  /**
   * Per-request system-prompt fragment that gets appended *after* the
   * persona via `--append-system-prompt`. Used for per-thread prompts and
   * context like recent reactions on this thread's assistant messages.
   * Empty/whitespace-only strings are ignored.
   */
  extraSystemPrompt?: string;
  signal?: AbortSignal;
}

interface StreamEventBase {
  type: string;
  subtype?: string;
  session_id?: string;
}

interface SystemInitEvent extends StreamEventBase {
  type: 'system';
  subtype: 'init';
  session_id: string;
}

interface AssistantEvent extends StreamEventBase {
  type: 'assistant';
  message: {
    content: Array<{ type: string; text?: string }>;
  };
}

interface ResultEvent extends StreamEventBase {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | string;
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  cost_usd?: number;
  duration_ms?: number;
  session_id: string;
}

type StreamEvent = SystemInitEvent | AssistantEvent | ResultEvent | StreamEventBase;

export interface ClaudeBridgeEvents {
  thinking: () => void;
  partial: (chunk: string) => void;
  sessionId: (id: string) => void;
}

export class ClaudeBridge extends EventEmitter {
  private readonly promptPath: string;
  private cachedPrompt: string | null = null;

  constructor(promptPath = path.resolve('src/prompts/sean.md')) {
    super();
    this.promptPath = promptPath;
  }

  override on<K extends keyof ClaudeBridgeEvents>(event: K, listener: ClaudeBridgeEvents[K]): this {
    return super.on(event, listener);
  }
  override emit<K extends keyof ClaudeBridgeEvents>(
    event: K,
    ...args: Parameters<ClaudeBridgeEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  private async loadPrompt(): Promise<string> {
    if (this.cachedPrompt !== null) return this.cachedPrompt;
    try {
      this.cachedPrompt = await readFile(this.promptPath, 'utf8');
    } catch (err) {
      logger.warn({ err, promptPath: this.promptPath }, 'persona prompt not readable; using empty');
      this.cachedPrompt = '';
    }
    return this.cachedPrompt;
  }

  async invoke(opts: ClaudeBridgeOptions): Promise<ClaudeBridgeResult> {
    const persona = await this.loadPrompt();
    const args = ['-p', opts.message, '--output-format', 'stream-json', '--verbose'];
    if (opts.sessionId) args.push('--resume', opts.sessionId);
    if (opts.model) args.push('--model', opts.model);
    // Compose the system-prompt argument: persona first, then any
    // per-request fragment (per-thread override + recent-reactions
    // feedback). Both pieces are trimmed; we drop empties so we never
    // emit `--append-system-prompt ""`.
    const combined = [persona, opts.extraSystemPrompt]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0)
      .join('\n\n');
    if (combined) args.push('--append-system-prompt', combined);

    const started = Date.now();
    const child = spawn('claude', args, {
      env: { ...sanitizedEnv(), ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return this.driveSubprocess(child, started, opts.signal);
  }

  private driveSubprocess(
    child: ChildProcess,
    startedAt: number,
    externalSignal?: AbortSignal,
  ): Promise<ClaudeBridgeResult> {
    const stdout = child.stdout as Readable;
    const stderr = child.stderr as Readable;
    return new Promise((resolve, reject) => {
      const partialChunks: string[] = [];
      let resolvedSessionId = '';
      let resultEvent: ResultEvent | undefined;
      let stderrBuf = '';
      let buffer = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 2_000);
        reject(new Error(`claude -p timed out after ${config.CLAUDE_CALL_TIMEOUT_MS}ms`));
      }, config.CLAUDE_CALL_TIMEOUT_MS);

      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.kill('SIGTERM');
        reject(new Error('aborted by caller'));
      };
      if (externalSignal) {
        if (externalSignal.aborted) return onAbort();
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }

      this.emit('thinking');

      stdout.setEncoding('utf8');
      stdout.on('data', (chunk: string) => {
        buffer += chunk;
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          let evt: StreamEvent;
          try {
            evt = JSON.parse(line) as StreamEvent;
          } catch (err) {
            logger.warn({ err, line: line.slice(0, 200) }, 'claude bridge: non-JSON line');
            continue;
          }

          if (evt.type === 'system' && (evt as SystemInitEvent).subtype === 'init') {
            resolvedSessionId = (evt as SystemInitEvent).session_id;
            this.emit('sessionId', resolvedSessionId);
            continue;
          }

          if (evt.type === 'assistant') {
            const blocks = (evt as AssistantEvent).message?.content ?? [];
            for (const b of blocks) {
              if (b.type === 'text' && typeof b.text === 'string') {
                partialChunks.push(b.text);
                this.emit('partial', b.text);
              }
            }
            continue;
          }

          if (evt.type === 'result') {
            resultEvent = evt as ResultEvent;
            if (resultEvent.session_id) resolvedSessionId = resultEvent.session_id;
            continue;
          }
        }
      });

      stderr.setEncoding('utf8');
      stderr.on('data', (chunk: string) => {
        stderrBuf += chunk;
        if (stderrBuf.length > 8_192) stderrBuf = stderrBuf.slice(-8_192);
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const durationMs = Date.now() - startedAt;
        const stderrSnippet = stderrBuf.slice(-2_000);

        if (code !== 0 && !resultEvent) {
          const rateLimited = detectRateLimit(stderrSnippet);
          resolve({
            text: '',
            sessionId: resolvedSessionId,
            durationMs,
            isError: true,
            errorMessage: `claude exited ${code}: ${stderrSnippet}`.trim(),
            rateLimited,
            costUsd: 0,
          });
          return;
        }

        const finalText =
          resultEvent?.result && resultEvent.result.trim().length > 0
            ? resultEvent.result
            : partialChunks.join('');

        const isError = Boolean(resultEvent?.is_error) || resultEvent?.subtype !== 'success';
        const rateLimited = detectRateLimit(stderrSnippet + ' ' + (resultEvent?.result ?? ''));
        const costUsd = resultEvent?.total_cost_usd ?? resultEvent?.cost_usd ?? 0;

        // NOTE: cost_usd is reported informationally even for subscription
        // calls in Claude Code 1.0.88+. It does NOT imply paid billing as
        // long as auth is via CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY
        // is unset. The boot-time verify-auth check enforces that invariant.

        resolve({
          text: finalText,
          sessionId: resolvedSessionId,
          durationMs,
          isError,
          ...(isError ? { errorMessage: resultEvent?.result ?? stderrSnippet } : {}),
          rateLimited,
          costUsd,
        });
      });
    });
  }
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function detectRateLimit(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('usage limit') ||
    lower.includes('max subscription') ||
    lower.includes('too many requests')
  );
}
