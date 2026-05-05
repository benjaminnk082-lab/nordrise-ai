import { ipcMain, net, app, shell, dialog, Notification, BrowserWindow } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';
import { getPendingUpdateVersion, quitAndInstall, getUpdateStatus, getUpdateLog, manualCheck } from './autoUpdate.js';
import { getStore, type QuickTaskInput } from './store.js';
import { hidePopup } from './popup.js';
import {
  getSettings,
  setSettings,
  resetSettings,
  type AppSettings,
} from './settingsStore.js';
import { detectOllama, listOllamaModels, streamOllama } from './ollama.js';
import { fetchPersona, clearPersonaCache } from './persona.js';
import {
  startVaultSync,
  stopVaultSync,
  fullSync,
  getVaultStatus,
  listSeanNotes,
  adoptSeanNote,
  dismissSeanNote,
} from './vaultSync.js';
import { runTeamsOAuth, type TeamsOAuthInput } from './teamsOAuth.js';
import { captureVismaCookie, type VismaCookieInput } from './vismaCookieCapture.js';

const DEFAULT_BACKEND = 'https://sean-production-d872.up.railway.app';
const TOKEN_SLOT = 'bearer';
/** Account name used for the per-user Claude OAuth token in the OS keychain. */
const CLAUDE_AUTH_SLOT = 'claude-oauth';
/** Expected prefix for a Claude OAuth token. */
const CLAUDE_OAUTH_PREFIX = 'sk-ant-oat01-';

// Use Electron's net.fetch (Chromium network stack) — more reliable in
// packaged apps than Node's global fetch on Windows where some TLS / undici
// quirks can cause spurious failures.
async function netFetch(url: string, init?: Parameters<typeof net.fetch>[1]): Promise<Response> {
  return net.fetch(url, init);
}

const activeStreams = new Map<string, AbortController>();

interface FetchPayload {
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

interface StreamStartPayload {
  streamId: string;
  text: string;
  controlSessionId: string | null;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  /** Optional Claude model override forwarded to the backend. */
  model?: string;
  /**
   * Optional MCP connector API keys. Forwarded as the `connectorKeys` field
   * in the backend body — Sean spreads them into the claude-code spawn env.
   * Stored only locally on the user's machine; never logged.
   */
  connectorKeys?: Record<string, string>;
  /**
   * v0.5.2 — permission mode + (for custom) per-action policy. Forwarded to
   * the backend so Sean's system prompt mirrors the user's chosen mode.
   */
  permissionMode?: 'auto' | 'manual' | 'custom';
  effectivePermissions?: Record<string, 'auto' | 'ask' | 'block'>;
}

interface ClaudeAuthTestResult {
  ok: boolean;
  error?: 'wrong_format' | 'too_short' | 'no_bearer' | string;
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
  ipcMain.handle('app:update-status', () => getUpdateStatus());
  ipcMain.handle('app:update-log', () => getUpdateLog());
  ipcMain.handle('app:update-check', () => manualCheck());

  ipcMain.handle('auth:get-token', () => getToken(TOKEN_SLOT));
  ipcMain.handle('auth:set-token', (_e, token: string) => setToken(TOKEN_SLOT, token));
  ipcMain.handle('auth:clear-token', () => deleteToken(TOKEN_SLOT));

  // Per-user Claude OAuth token. Stored in the OS keychain under a separate
  // account slot so it can't collide with the bearer-token. Forwarded
  // ephemerally on every /control/message call (see stream-start below).
  ipcMain.handle('claude-auth:get-token', () => getToken(CLAUDE_AUTH_SLOT));
  ipcMain.handle('claude-auth:set-token', (_e, token: string) =>
    setToken(CLAUDE_AUTH_SLOT, token),
  );
  ipcMain.handle('claude-auth:clear-token', () => deleteToken(CLAUDE_AUTH_SLOT));
  // Lightweight client-side validation: check format + length only. A "real"
  // round-trip test (does this token actually authenticate against
  // Anthropic's API?) is too complex for v0.3.0 — the first real request
  // will surface auth failures via the bridge error frame, which is enough
  // for users to course-correct.
  ipcMain.handle(
    'claude-auth:test',
    async (_e, token: string): Promise<ClaudeAuthTestResult> => {
      const t = (token ?? '').trim();
      if (!t.startsWith(CLAUDE_OAUTH_PREFIX)) return { ok: false, error: 'wrong_format' };
      if (t.length < 50) return { ok: false, error: 'too_short' };
      // Optionally verify that we still have a bearer-token so the user
      // hasn't logged out concurrently. This isn't a hard requirement but
      // surfaces a useful error.
      const bearer = await getToken(TOKEN_SLOT);
      if (!bearer) return { ok: false, error: 'no_bearer' };
      return { ok: true };
    },
  );

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

    // Pull the per-user Claude OAuth token from the keychain. When set, the
    // backend uses it to spawn claude-code; when null, claude-code falls
    // back to the server-side default. Renderer never sees this value —
    // it lives entirely in main.
    const claudeAuthToken = await getToken(CLAUDE_AUTH_SLOT);

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
          ...(payload.connectorKeys && Object.keys(payload.connectorKeys).length
            ? { connectorKeys: payload.connectorKeys }
            : {}),
          ...(claudeAuthToken ? { claudeAuthToken } : {}),
          ...(payload.permissionMode
            ? { permissionMode: payload.permissionMode }
            : {}),
          ...(payload.effectivePermissions
            ? { effectivePermissions: payload.effectivePermissions }
            : {}),
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

  // Apply the user's preferred opacity to the BrowserWindow that initiated
  // the call. Clamped to [0.7, 1.0]. Cosmetic only.
  ipcMain.handle('window:set-opacity', (e, opacity: number) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    const clamped = Math.max(0.7, Math.min(1.0, Number(opacity) || 1.0));
    w.setOpacity(clamped);
    return true;
  });

  // Frameless-window controls. The renderer drives the new titlebar's
  // min/max/close buttons through these. Each handler resolves the
  // sender's window so a multi-window setup (popup + main) addresses
  // the right one. State broadcasts via `window:state` so the renderer
  // can swap the maximize ↔ restore icon and toggle the maximized
  // body class for outer-radius adjustments.
  function broadcastWindowState(w: BrowserWindow): void {
    w.webContents.send('window:state', {
      maximized: w.isMaximized(),
      fullscreen: w.isFullScreen(),
    });
  }
  ipcMain.handle('window:minimize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    broadcastWindowState(w);
    return w.isMaximized();
  });
  ipcMain.handle('window:close', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.close();
  });
  ipcMain.handle('window:is-maximized', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return w ? w.isMaximized() : false;
  });
  // Auto-broadcast when the OS-level maximize/restore happens (drag-to-edge,
  // double-click on titlebar, Win+Up shortcut). The renderer invokes this
  // once on titlebar mount; main wires the per-window listeners and pushes
  // an initial `window:state` event back so the renderer doesn't need a
  // second round-trip.
  //
  // We deduplicate per-window with a WeakSet so a hot-reload doesn't double-
  // wire the listeners and leak.
  const subscribed = new WeakSet<BrowserWindow>();
  ipcMain.handle('window:subscribe-state', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (!subscribed.has(w)) {
      subscribed.add(w);
      const onChange = () => broadcastWindowState(w);
      w.on('maximize', onChange);
      w.on('unmaximize', onChange);
      w.on('enter-full-screen', onChange);
      w.on('leave-full-screen', onChange);
    }
    broadcastWindowState(w);
  });

  // Open a local file path with the OS default app. Used by the
  // app-improvements UI to open the spec markdown in the user's vault.
  // Strict: rejects non-string / empty inputs and surfaces the result.
  ipcMain.handle('shell:open-path', async (_e, path: string) => {
    if (typeof path !== 'string' || !path.trim()) return false;
    try {
      const err = await shell.openPath(path);
      // shell.openPath resolves to '' on success, or an error message
      return err === '' || err === undefined;
    } catch {
      return false;
    }
  });

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

      // Cross-model identity: fetch Sean's persona from the backend (cached)
      // and inject via Ollama's `system` parameter. Empty string means we
      // either failed to fetch or the user isn't authed yet — fall through
      // without a system prompt rather than crash the stream.
      const bearer = await getToken(TOKEN_SLOT);
      const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
      const persona = bearer ? await fetchPersona(backend, bearer) : '';

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
          ...(persona ? { system: persona } : {}),
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
  // Open an external URL in the user's default browser. Used by Settings
  // help links. Strict allowlist on the protocol: http/https only, never
  // `file:` / `javascript:` / custom schemes.
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  // Connector OAuth flows — opens a real auth window (browser for MS,
  // embedded BrowserWindow for Visma) and returns the captured credential
  // to the renderer. Renderer is responsible for storing it (typically by
  // patching settings.connectors via the existing settings:set channel).
  ipcMain.handle('teams:oauth-start', async (_e, input: TeamsOAuthInput) => {
    if (!input || typeof input.clientId !== 'string') {
      return { ok: false, error: 'invalid_input' };
    }
    return runTeamsOAuth(input);
  });
  ipcMain.handle('visma:capture-cookie', async (_e, input: VismaCookieInput) => {
    if (!input || typeof input.school !== 'string') {
      return { ok: false, error: 'invalid_input' };
    }
    return captureVismaCookie(input);
  });

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
  // Routines: surface a desktop Notification when the renderer detects a
  // newly-finished successful run. Click focuses the main window.
  ipcMain.handle(
    'routines:notify',
    (_e, payload: { name: string; preview: string }) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: `Routine: ${payload.name}`,
        body: (payload.preview ?? '').slice(0, 240),
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

  // Obsidian-vault sync (PC -> Sean) + Sean's notes proposals.
  ipcMain.handle('vault:status', () => getVaultStatus());
  ipcMain.handle('vault:start', async (_e, vaultPath: string) => {
    await startVaultSync(vaultPath);
  });
  ipcMain.handle('vault:stop', async () => {
    await stopVaultSync();
  });
  ipcMain.handle('vault:resync', async (_e, vaultPath: string) => {
    await fullSync(vaultPath);
  });
  ipcMain.handle('vault:pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled) return null;
    return r.filePaths[0] ?? null;
  });
  ipcMain.handle('vault:list-sean-notes', () => listSeanNotes());
  ipcMain.handle(
    'vault:adopt-note',
    (_e, payload: { path: string; vaultRoot: string }) =>
      adoptSeanNote(payload.path, payload.vaultRoot),
  );
  ipcMain.handle('vault:dismiss-note', (_e, p: string) => dismissSeanNote(p));

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
