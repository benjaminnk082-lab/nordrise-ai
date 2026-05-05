// Renderer-side bridge for the proactive engine REST surface.
//
// All requests go via `control:fetch` (main-process Bearer auth lives there)
// — we never call the backend directly from the renderer.

import type {
  ProactiveSettingsRow,
  ProactiveAttemptRow,
  ProactiveRunNowResult,
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

async function ipcFetch<T>(path: string, init: IpcFetchInit = {}): Promise<T> {
  const r = await window.nordrise.invoke<IpcFetchResponse<unknown>>(
    'control:fetch',
    {
      path,
      method: init.method,
      body: init.body,
    },
  );
  if (!r.ok) {
    const detail =
      typeof r.body === 'string'
        ? r.body
        : (r.body as { error?: string } | null)?.error ?? 'unknown';
    throw new Error(`${path} → ${r.status}: ${detail}`);
  }
  return r.body as T;
}

export type ProactiveSettingsPatch = Partial<{
  enabled: boolean;
  quietHourStart: number;
  quietHourEnd: number;
  maxPerHour: number;
  maxPerDay: number;
  cadenceMin: number;
}>;

export const proactiveApi = {
  getSettings: () =>
    ipcFetch<ProactiveSettingsRow>('/control/proactive/settings'),
  setSettings: (patch: ProactiveSettingsPatch) =>
    ipcFetch<ProactiveSettingsRow>('/control/proactive/settings', {
      method: 'PATCH',
      body: patch,
    }),
  attempts: () =>
    ipcFetch<{ attempts: ProactiveAttemptRow[] }>(
      '/control/proactive/attempts',
    ),
  runNow: () =>
    ipcFetch<ProactiveRunNowResult>('/control/proactive/run-now', {
      method: 'POST',
      body: {},
    }),
};
