import type { ControlSessionSummary, ControlMessageRow } from '../../src/server-types';

interface IpcFetchInit {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

interface IpcFetchResponse<T> {
  ok: boolean;
  status: number;
  body: T;
}

async function ipcFetch<T>(path: string, init: IpcFetchInit = {}): Promise<T> {
  const r = await window.nordrise.invoke<IpcFetchResponse<unknown>>('control:fetch', {
    path,
    method: init.method,
    body: init.body,
  });
  if (!r.ok) {
    const detail =
      typeof r.body === 'string'
        ? r.body
        : (r.body as { error?: string } | null)?.error ?? 'unknown';
    throw new Error(`${path} → ${r.status}: ${detail}`);
  }
  return r.body as T;
}

export async function listSessions(): Promise<ControlSessionSummary[]> {
  const r = await ipcFetch<{ sessions: ControlSessionSummary[] }>('/control/sessions');
  return r.sessions;
}

export async function newSession(): Promise<ControlSessionSummary> {
  return ipcFetch<ControlSessionSummary>('/control/session/new', {
    method: 'POST',
    body: {},
  });
}

export async function listMessages(
  sessionId: string,
  since?: string,
): Promise<ControlMessageRow[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const r = await ipcFetch<{ messages: ControlMessageRow[] }>(
    `/control/sessions/${sessionId}/messages${q}`,
  );
  return r.messages;
}

export async function listHistory(
  source: 'telegram' | 'all' = 'telegram',
  limit = 100,
): Promise<ControlMessageRow[]> {
  const r = await ipcFetch<{ messages: ControlMessageRow[] }>(
    `/control/history?source=${source}&limit=${limit}`,
  );
  return r.messages;
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown> & { text?: string; message?: string };
}

export interface SendOpts {
  controlSessionId: string | null;
  text: string;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  onFrame: (f: SseFrame) => void;
  onDone: () => void;
}

export function sendMessageStream(opts: SendOpts): { abort: () => void } {
  const streamId = `s${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = `control:stream-event:${streamId}`;
  const off = window.nordrise.on(channel, (frame: unknown) => {
    const f = frame as SseFrame;
    if (f.event === 'done-stream') {
      off();
      opts.onDone();
      return;
    }
    opts.onFrame(f);
  });
  void window.nordrise.invoke('control:stream-start', {
    streamId,
    text: opts.text,
    controlSessionId: opts.controlSessionId,
    attachments: opts.attachments,
  });
  return {
    abort: () => {
      void window.nordrise.invoke('control:stream-abort', streamId);
      off();
    },
  };
}
