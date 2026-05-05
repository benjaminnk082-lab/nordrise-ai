import type {
  ControlSessionSummary,
  ControlMessageRow,
  RoutineSummary,
  RoutineRunRow,
  RoutineRunRecent,
  RoutineCreateInput,
  RoutinePatchInput,
  RoutineTemplate,
  SuggestionSummary,
  SuggestionGenerateResult,
  PinnedMessage,
  VaultSearchMatch,
  ProactiveAttemptRow,
  AppImprovementRow,
  AppImprovementScanResult,
  ProjectRow,
  UsageSummaryResponse,
} from '../../src/server-types';

interface IpcFetchInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

interface IpcFetchResponse<T> {
  ok: boolean;
  status: number;
  body: T;
}

export async function ipcFetch<T>(path: string, init: IpcFetchInit = {}): Promise<T> {
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

// ---------- Routines ----------

export async function listRoutines(): Promise<RoutineSummary[]> {
  const r = await ipcFetch<{ routines: RoutineSummary[] }>('/control/routines');
  return r.routines;
}

export async function createRoutine(input: RoutineCreateInput): Promise<RoutineSummary> {
  return ipcFetch<RoutineSummary>('/control/routines', {
    method: 'POST',
    body: input,
  });
}

export async function updateRoutine(
  id: string,
  patch: RoutinePatchInput,
): Promise<RoutineSummary> {
  return ipcFetch<RoutineSummary>(`/control/routines/${id}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function deleteRoutine(id: string): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/routines/${id}`, { method: 'DELETE' });
}

export async function runRoutineNow(id: string): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/routines/${id}/run`, {
    method: 'POST',
    body: {},
  });
}

export async function listRoutineRuns(id: string): Promise<RoutineRunRow[]> {
  const r = await ipcFetch<{ runs: RoutineRunRow[] }>(`/control/routines/${id}/runs`);
  return r.runs;
}

export async function listRecentRuns(): Promise<RoutineRunRecent[]> {
  const r = await ipcFetch<{ runs: RoutineRunRecent[] }>('/control/routines/runs/recent');
  return r.runs;
}

export async function listRoutineLibrary(): Promise<RoutineTemplate[]> {
  const r = await ipcFetch<{ templates: RoutineTemplate[] }>('/control/routine-library');
  return r.templates;
}

// ---------- Reactions ----------

/**
 * Set or update a reaction on an assistant message. Server upserts so the
 * same message ends up with at most one reaction. Renderer should optimistic
 * update the local state before awaiting this — the call is best-effort.
 */
export async function setReaction(
  messageId: string,
  value: 'up' | 'down',
): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/messages/${messageId}/reaction`, {
    method: 'POST',
    body: { value },
  });
}

export async function clearReaction(messageId: string): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/messages/${messageId}/reaction`, {
    method: 'DELETE',
  });
}

// ---------- Pinned messages ----------

/**
 * Toggle the pinned state on a message. Server reads current value, flips
 * it, returns the new value. Renderer should optimistic-update before
 * awaiting; failures roll back via a refetch.
 */
export async function togglePin(
  messageId: string,
): Promise<{ ok: boolean; pinned: boolean }> {
  return ipcFetch<{ ok: boolean; pinned: boolean }>(
    `/control/messages/${messageId}/pin`,
    { method: 'POST', body: {} },
  );
}

export async function listPinned(): Promise<PinnedMessage[]> {
  const r = await ipcFetch<{ pinned: PinnedMessage[] }>('/control/messages/pinned');
  return r.pinned;
}

// ---------- Vault search (used by Ctrl+F global search) ----------

export async function vaultSearch(query: string): Promise<VaultSearchMatch[]> {
  const r = await ipcFetch<{ matches: VaultSearchMatch[] }>(
    `/control/vault/search?q=${encodeURIComponent(query)}`,
  );
  return r.matches;
}

// ---------- Audit log feed (Settings → Aktivitet) ----------

export async function listProactiveAttempts(): Promise<ProactiveAttemptRow[]> {
  const r = await ipcFetch<{ attempts: ProactiveAttemptRow[] }>(
    '/control/proactive/attempts',
  );
  return r.attempts;
}

// ---------- Phase 3 — projects + usage ----------

export const projectsApi = {
  list: async (): Promise<ProjectRow[]> => {
    const r = await ipcFetch<{ projects: ProjectRow[] }>('/control/projects');
    return r.projects;
  },
  create: (name: string, description?: string) =>
    ipcFetch<ProjectRow>('/control/projects', {
      method: 'POST',
      body: { name, ...(description ? { description } : {}) },
    }),
  /** Tag a thread with a project (or clear via `null`). */
  assignToSession: (sessionId: string, projectId: string | null) =>
    ipcFetch<{ ok: boolean }>(`/control/sessions/${sessionId}/project`, {
      method: 'PATCH',
      body: { projectId },
    }),
};

export const usageApi = {
  /** `since` is ISO. Default is "last 30 days". */
  summary: (since?: string) => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return ipcFetch<UsageSummaryResponse>(`/control/usage${q}`);
  },
  /** Fetch the same data as a CSV string. */
  csv: async (since?: string): Promise<string> => {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    const r = await window.nordrise.invoke<{
      ok: boolean;
      status: number;
      body: unknown;
    }>('control:fetch', { path: `/control/usage.csv${q}`, method: 'GET' });
    if (!r.ok) throw new Error(`csv fetch failed: ${r.status}`);
    return typeof r.body === 'string' ? r.body : '';
  },
};

// ---------- App-improvements (Sean's self-improvement queue) ----------

export const appImprovementsApi = {
  list: async (): Promise<AppImprovementRow[]> => {
    const r = await ipcFetch<{ improvements: AppImprovementRow[] }>(
      '/control/app-improvements',
    );
    return r.improvements;
  },
  scanNow: () =>
    ipcFetch<AppImprovementScanResult>(
      '/control/app-improvements/scan-now',
      { method: 'POST', body: {} },
    ),
  approve: (id: string) =>
    ipcFetch<AppImprovementRow>(`/control/app-improvements/${id}/approve`, {
      method: 'POST',
      body: {},
    }),
  reject: (id: string) =>
    ipcFetch<AppImprovementRow>(`/control/app-improvements/${id}/reject`, {
      method: 'POST',
      body: {},
    }),
  delete: (id: string) =>
    ipcFetch<{ ok: boolean }>(`/control/app-improvements/${id}`, {
      method: 'DELETE',
    }),
};

// ---------- Per-thread system prompt ----------

/**
 * PATCH a thread's metadata. Pass `systemPrompt: null` (or "") to clear the
 * override and fall back to Sean's persona alone.
 */
export async function updateSession(
  sessionId: string,
  patch: { title?: string; systemPrompt?: string | null },
): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/sessions/${sessionId}`, {
    method: 'PATCH',
    body: patch,
  });
}

// ---------- Suggestions ----------

export async function listSuggestions(status?: string): Promise<SuggestionSummary[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await ipcFetch<{ suggestions: SuggestionSummary[] }>(
    `/control/suggestions${q}`,
  );
  return r.suggestions;
}

export async function approveSuggestion(id: string): Promise<SuggestionSummary> {
  return ipcFetch<SuggestionSummary>(`/control/suggestions/${id}/approve`, {
    method: 'POST',
    body: {},
  });
}

export async function rejectSuggestion(id: string): Promise<SuggestionSummary> {
  return ipcFetch<SuggestionSummary>(`/control/suggestions/${id}/reject`, {
    method: 'POST',
    body: {},
  });
}

export async function deleteSuggestion(id: string): Promise<void> {
  await ipcFetch<{ ok: boolean }>(`/control/suggestions/${id}`, { method: 'DELETE' });
}

export async function generateSuggestionsNow(): Promise<SuggestionGenerateResult> {
  return ipcFetch<SuggestionGenerateResult>(`/control/suggestions/generate-now`, {
    method: 'POST',
    body: {},
  });
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
  /**
   * v0.5.2 — permission policy from the renderer's settings. The backend
   * appends a system-prompt fragment that tells Sean how to respect the
   * mode (auto/manual/custom). Auto sends nothing — implicit default.
   */
  permissionMode?: 'auto' | 'manual' | 'custom';
  /**
   * Per-action permissions; only meaningful when `permissionMode === 'custom'`.
   * Renderer reads from `settings.permissions` and passes through.
   */
  effectivePermissions?: Record<string, 'auto' | 'ask' | 'block'>;
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
    permissionMode: opts.permissionMode,
    effectivePermissions: opts.effectivePermissions,
  });
  return {
    abort: () => {
      void window.nordrise.invoke('control:stream-abort', streamId);
      off();
    },
  };
}
