import { ipcMain, net, app } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';
import { getPendingUpdateVersion } from './autoUpdate.js';

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
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:pending-update', () => getPendingUpdateVersion());

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
}
