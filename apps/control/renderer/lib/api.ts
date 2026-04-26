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

export interface UploadResult {
  fileId: string;
  workspacePath: string;
  filename: string;
  size: number;
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const data = await file.arrayBuffer();
  const r = await window.nordrise.invoke<{
    ok: boolean;
    status: number;
    body: UploadResult & { error?: string; error_code?: string };
  }>('control:upload', {
    filename: file.name,
    mime: file.type || 'application/octet-stream',
    data,
  });
  if (!r.ok) {
    const detail =
      (typeof r.body === 'object' && r.body !== null
        ? (r.body.error ?? r.body.error_code)
        : null) ?? 'unknown';
    throw new Error(`upload failed (${r.status}): ${detail}`);
  }
  return r.body as UploadResult;
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown> & { text?: string; message?: string };
}

export interface SendOpts {
  controlSessionId: string | null;
  text: string;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  /**
   * Optional model id. Either a Claude model (claude-opus-4-7 etc.) — which
   * is forwarded to Sean — or `ollama:<modelName>`, which is routed locally
   * via the Ollama IPC bridge and bypasses Sean entirely.
   */
  model?: string;
  /**
   * MCP connector keys (FIRECRAWL_API_KEY, GITHUB_PERSONAL_ACCESS_TOKEN).
   * Forwarded ephemerally with the message. Sean injects them into the
   * claude-code subprocess env. Never persisted backend-side.
   */
  connectorKeys?: Record<string, string>;
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

  if (opts.model && opts.model.startsWith('ollama:')) {
    const ollamaModel = opts.model.slice('ollama:'.length);
    void window.nordrise.invoke('ollama:stream-start', {
      streamId,
      prompt: opts.text,
      model: ollamaModel,
      controlSessionId: opts.controlSessionId,
    });
    return {
      abort: () => {
        void window.nordrise.invoke('ollama:stream-abort', streamId);
        off();
      },
    };
  }

  void window.nordrise.invoke('control:stream-start', {
    streamId,
    text: opts.text,
    controlSessionId: opts.controlSessionId,
    attachments: opts.attachments,
    model: opts.model,
    connectorKeys: opts.connectorKeys,
  });
  return {
    abort: () => {
      void window.nordrise.invoke('control:stream-abort', streamId);
      off();
    },
  };
}
