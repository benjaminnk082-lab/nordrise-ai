/**
 * seanCall — main-side caller of `/control/message`.
 *
 * Used by the heartbeat daemon (`heartbeat.ts`) to round-trip Sean
 * without the renderer in the loop. Mirrors the SSE consumer that
 * lives inside `ipc.ts`'s `control:stream-start` handler — the
 * difference is this returns the accumulated assistant text directly
 * (no IPC events emitted) so callers can write straightforward async
 * code.
 *
 * Reads the bearer token from the keychain via `keychain.ts`. Per
 * CLAUDE.md §6.4, the renderer never fetches the backend directly —
 * this is main fetching, which is allowed and is the same code path
 * the existing `control:stream-start` handler uses.
 */
import { net } from 'electron';
import { getToken } from './keychain.js';

const TOKEN_SLOT = 'bearer';
const CLAUDE_AUTH_SLOT = 'claude-oauth';
const DEFAULT_BACKEND = 'https://sean-production-d872.up.railway.app';

function backendUrl(): string {
  return process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
}

export interface AskSeanOptions {
  /** Default `null` — heartbeat is intentionally not part of any thread. */
  controlSessionId?: string | null;
  /** Optional model override. Heartbeat uses Haiku to save quota. */
  model?: string;
  /** Abort signal for caller-side cancel. */
  signal?: AbortSignal;
  /** Hard timeout in ms; default 60_000. */
  timeoutMs?: number;
}

export interface AskSeanResult {
  text: string;
  durationMs: number;
  isError: boolean;
  rateLimited: boolean;
  errorMessage?: string;
  controlSessionId?: string;
}

/**
 * POST /control/message and consume the SSE stream until `done`. Returns
 * the accumulated assistant text. Errors short-circuit with `isError`
 * set; the caller is expected to handle (heartbeat suppresses, the UI
 * could surface).
 */
export async function askSean(
  prompt: string,
  opts: AskSeanOptions = {},
): Promise<AskSeanResult> {
  const startedAt = Date.now();
  const token = await getToken(TOKEN_SLOT);
  if (!token) {
    return {
      text: '',
      durationMs: Date.now() - startedAt,
      isError: true,
      rateLimited: false,
      errorMessage: 'no_bearer_token',
    };
  }
  const claudeAuthToken = await getToken(CLAUDE_AUTH_SLOT);

  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new DOMException('seanCall timeout', 'AbortError')),
    opts.timeoutMs ?? 60_000,
  );
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await net.fetch(`${backendUrl()}/control/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        controlSessionId: opts.controlSessionId ?? null,
        text: prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(claudeAuthToken ? { claudeAuthToken } : {}),
      }),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return {
      text: '',
      durationMs: Date.now() - startedAt,
      isError: true,
      rateLimited: false,
      errorMessage: (err as Error).message ?? 'fetch_failed',
    };
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    return {
      text: '',
      durationMs: Date.now() - startedAt,
      isError: true,
      rateLimited: res.status === 429,
      errorMessage: `http_${res.status}`,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let assistantText = '';
  let isError = false;
  let rateLimited = false;
  let errorMessage: string | undefined;
  let resolvedSessionId: string | undefined;

  try {
    // Consume frames until we see `done` or `done-stream` or the
    // body closes. SSE frames are `event:`/`data:` pairs separated by
    // a blank line.
    /* eslint-disable no-constant-condition */
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = block.split('\n');
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        let data: unknown;
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (event === 'partial') {
          const t = (data as { text?: string }).text;
          if (typeof t === 'string') assistantText += t;
        } else if (event === 'session') {
          const sid = (data as { controlSessionId?: string }).controlSessionId;
          if (sid) resolvedSessionId = sid;
        } else if (event === 'error') {
          isError = true;
          const m = (data as { message?: string }).message ?? 'sse_error';
          errorMessage = m;
          if (m === 'rate_limit') rateLimited = true;
        } else if (event === 'done') {
          // graceful end; let the loop exit when the body closes
        }
      }
    }
    /* eslint-enable no-constant-condition */
  } catch (err) {
    isError = true;
    errorMessage = (err as Error).message ?? 'stream_read_failed';
  } finally {
    clearTimeout(timer);
  }

  return {
    text: assistantText,
    durationMs: Date.now() - startedAt,
    isError,
    rateLimited,
    errorMessage,
    controlSessionId: resolvedSessionId,
  };
}
