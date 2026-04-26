import { ipcMain, net, app, Notification, BrowserWindow } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';
import { getPendingUpdateVersion, quitAndInstall } from './autoUpdate.js';
import { getStore, type QuickTaskInput } from './store.js';
import { hidePopup } from './popup.js';
import {
  getSettings,
  setSettings,
  resetSettings,
  type AppSettings,
} from './settingsStore.js';
import { detectOllama, listOllamaModels, streamOllama } from './ollama.js';

const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';
const TOKEN_SLOT = 'bearer';

// Use Electron's net.fetch (Chromium network stack) — more reliable in
// packaged apps than Node's global fetch on Windows where some TLS / undici
// quirks can cause spurious failures.
async function netFetch(url: string, init?: Parameters<typeof net.fetch>[1]): Promise<Response> {
  return net.fetch(url, init);
}

const activeStreams = new Map<string, AbortController>();

interface FetchPayload {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
}

interface StreamStartPayload {
  streamId: string;
  text: string;
  controlSessionId: string | null;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  /** Optional Claude model override forwarded to the backend. */
  model?: string;
}

interface OllamaStreamStartPayload {
  streamId: string;
  prompt: string;
  model: string;
  controlSessionId: string | null;
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:pending-update', () => getPendingUpdateVersion());
  ipcMain.handle('app:quit-and-install', () => { quitAndInstall(); });

  ipcMain.handle('auth:get-token', () => getToken(TOKEN_SLOT));
  ipcMain.handle('auth:set-token', (_e, token: string) => setToken(TOKEN_SLOT, token));
  ipcMain.handle('auth:clear-token', () => deleteToken(TOKEN_SLOT));

  ipcMain.handle('config:backend-url', () => process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND);

  ipcMain.handle('healthz', async () => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    try {
      const r = await netFetch(`${backend}/healthz`);
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (err) {
      return { status: 0, body: null, error: String((err as Error).message) };
    }
  });

  ipcMain.handle('auth:verify-token', async (_e, token: string) => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    try {
      const r = await netFetch(`${backend}/control/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: r.ok, status: r.status };
    } catch (err) {
      return { ok: false, status: 0, error: String((err as Error).message) };
    }
  });

  // Generic backend GET/POST/PATCH helper. Renderer never reaches the backend
  // directly — that would trigger CORS preflight from the app:// origin which
  // the Sean API does not handle.
  ipcMain.handle('control:fetch', async (_e, payload: FetchPayload) => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const token = await getToken(TOKEN_SLOT);
    if (!token) return { ok: false, status: 401, body: { error: 'no_token' } };
    try {
      const r = await netFetch(`${backend}${payload.path}`, {
        method: payload.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: payload.body !== undefined ? JSON.stringify(payload.body) : undefined,
      });
      const text = await r.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = text; }
      return { ok: r.ok, status: r.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { error: String((err as Error).message) } };
    }
  });

  // Multipart upload bridge — renderer reads the dropped File into an
  // ArrayBuffer (which structured-clones cleanly across IPC) and main
  // reconstructs FormData so the backend sees a normal multipart POST.
  // This avoids CORS and keeps the renderer Node-free.
  ipcMain.handle('control:upload', async (
    _e,
    payload: { filename: string; mime: string; data: ArrayBuffer | Uint8Array },
  ) => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const token = await getToken(TOKEN_SLOT);
    if (!token) return { ok: false, status: 401, body: { error: 'no_token' } };
    try {
      // FormData / Blob are globals in Node 20+ (Electron 33 ships Node 20).
      // The `tsconfig.main.json` doesn't include the DOM lib so we cast to
      // `any` for the constructor call to keep the type-checker happy.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FD = (globalThis as any).FormData;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const BlobCtor = (globalThis as any).Blob;
      const fd = new FD();
      const bytes =
        payload.data instanceof Uint8Array
          ? payload.data
          : new Uint8Array(payload.data);
      fd.append(
        'file',
        new BlobCtor([bytes], { type: payload.mime }),
        payload.filename,
      );
      const r = await netFetch(`${backend}/control/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const text = await r.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = text; }
      return { ok: r.ok, status: r.status, body };
    } catch (err) {
      return { ok: false, status: 0, body: { error: String((err as Error).message) } };
    }
  });

  // SSE bridge — runs the streaming consumer in main and forwards parsed
  // event frames back to renderer via webContents.send. The renderer
  // subscribes to `control:stream-event:<streamId>` and sees the same frame
  // shape the backend emits, plus a synthetic `done-stream` terminator.
  ipcMain.handle('control:stream-start', async (e, payload: StreamStartPayload) => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const token = await getToken(TOKEN_SLOT);
    const channel = `control:stream-event:${payload.streamId}`;
    if (!token) {
      e.sender.send(channel, { event: 'error', data: { message: 'no_token' } });
      e.sender.send(channel, { event: 'done-stream', data: {} });
      return;
    }
    const ac = new AbortController();
    activeStreams.set(payload.streamId, ac);

    try {
      const res = await netFetch(`${backend}/control/message`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          controlSessionId: payload.controlSessionId,
          text: payload.text,
          attachments: payload.attachments,
          ...(payload.model ? { model: payload.model } : {}),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        e.sender.send(channel, {
          event: 'error',
          data: { message: `http_${res.status}` },
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
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
          try {
            const data = JSON.parse(dataLines.join('\n'));
            e.sender.send(channel, { event, data });
          } catch {
            // skip malformed frame
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).name === 'AbortError'
        ? 'aborted'
        : String((err as Error).message);
      e.sender.send(channel, { event: 'error', data: { message: msg } });
    } finally {
      activeStreams.delete(payload.streamId);
      e.sender.send(channel, { event: 'done-stream', data: {} });
    }
  });

  ipcMain.handle('control:stream-abort', (_e, streamId: string) => {
    const ac = activeStreams.get(streamId);
    if (ac) { ac.abort(); activeStreams.delete(streamId); }
  });

  // Quick-tasks (SQLite-backed)
  ipcMain.handle('qt:list', () => getStore().list());
  ipcMain.handle('qt:get', (_e, id: string) => getStore().get(id));
  ipcMain.handle('qt:create', (_e, input: QuickTaskInput) =>
    getStore().create(input),
  );
  ipcMain.handle(
    'qt:update',
    (_e, p: { id: string; patch: Partial<QuickTaskInput> }) =>
      getStore().update(p.id, p.patch),
  );
  ipcMain.handle('qt:delete', (_e, id: string) => getStore().delete(id));

  // App settings (model preferences, Ollama config) — JSON-backed.
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) =>
    setSettings(patch),
  );
  ipcMain.handle('settings:reset', () => resetSettings());

  // Ollama (localhost only)
  ipcMain.handle('ollama:detect', (_e, host: string) => detectOllama(host));
  ipcMain.handle('ollama:list-models', (_e, host: string) =>
    listOllamaModels(host),
  );
  ipcMain.handle(
    'ollama:stream-start',
    async (e, payload: OllamaStreamStartPayload) => {
      const settings = getSettings();
      const host = settings.ollamaHost || 'http://localhost:11434';
      const channel = `control:stream-event:${payload.streamId}`;
      const ac = new AbortController();
      activeStreams.set(payload.streamId, ac);

      // Surface a "session" frame mirror so the renderer's existing useStream
      // bookkeeping still runs (controlSessionId is what it ultimately cares
      // about). claudeSessionId is left empty since Sean isn't involved.
      if (payload.controlSessionId) {
        e.sender.send(channel, {
          event: 'session',
          data: {
            claudeSessionId: '',
            controlSessionId: payload.controlSessionId,
          },
        });
      }
      e.sender.send(channel, { event: 'thinking', data: { at: Date.now() } });

      let fullResponse = '';
      const startedAt = Date.now();
      let errored = false;

      try {
        await streamOllama({
          host,
          model: payload.model,
          prompt: payload.prompt,
          signal: ac.signal,
          onChunk: (text) => {
            fullResponse += text;
            e.sender.send(channel, { event: 'partial', data: { text } });
          },
          onError: (message) => {
            errored = true;
            e.sender.send(channel, { event: 'error', data: { message } });
          },
          onDone: () => {
            // handled in finally
          },
        });

        if (!errored) {
          e.sender.send(channel, {
            event: 'done',
            data: {
              durationMs: Date.now() - startedAt,
              costUsdInformational: 0,
              isError: false,
            },
          });

          // Persist user prompt + assistant reply via the new backend
          // endpoint so the conversation shows up in normal history queries.
          if (payload.controlSessionId && fullResponse.trim()) {
            const token = await getToken(TOKEN_SLOT);
            if (token) {
              const backend =
                process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
              const post = (role: 'user' | 'assistant', content: string) =>
                netFetch(
                  `${backend}/control/sessions/${payload.controlSessionId}/messages`,
                  {
                    method: 'POST',
                    headers: {
                      Authorization: `Bearer ${token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      role,
                      content,
                      model: `ollama:${payload.model}`,
                    }),
                  },
                ).catch(() => null);
              await post('user', payload.prompt);
              await post('assistant', fullResponse);
            }
          }
        }
      } finally {
        activeStreams.delete(payload.streamId);
        e.sender.send(channel, { event: 'done-stream', data: {} });
      }
    },
  );
  ipcMain.handle('ollama:stream-abort', (_e, streamId: string) => {
    const ac = activeStreams.get(streamId);
    if (ac) {
      ac.abort();
      activeStreams.delete(streamId);
    }
  });

  // Mini-popup lifecycle + reply-toast
  ipcMain.handle('popup:close', () => {
    hidePopup();
  });
  ipcMain.handle(
    'popup:reply',
    (_e, payload: { user: string; assistant: string }) => {
      if (!Notification.isSupported()) return;
      const body = (payload.assistant || '').slice(0, 240) || '(tomt svar)';
      const n = new Notification({
        title: 'Sean svarte',
        body,
        silent: false,
      });
      n.on('click', () => {
        const all = BrowserWindow.getAllWindows().filter(
          (w) => !w.webContents.getURL().includes('/popup/'),
        );
        const main = all[0];
        if (main) {
          if (main.isMinimized()) main.restore();
          main.show();
          main.focus();
        }
      });
      n.show();
    },
  );
}
