// Renderer-side bridge for app settings + Ollama detection.
// Mirror the AppSettings shape from apps/control/main/settingsStore.ts.

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export type DefaultModelChoice = ClaudeModelId | 'auto';

export interface ConnectorSettings {
  firecrawl: { enabled: boolean; apiKey: string };
  github: { enabled: boolean; token: string };
  vercel: { enabled: boolean; token: string };
}

export interface VaultSettings {
  enabled: boolean;
  localPath: string;
  syncInterval: number;
}

export type PermissionMode = 'auto' | 'ask' | 'block';

export interface PermissionSettings {
  vaultWrite: PermissionMode;
  telegramSend: PermissionMode;
  webSearch: PermissionMode;
  githubAccess: PermissionMode;
  shellExec: PermissionMode;
}

export interface AppSettings {
  defaultModel: DefaultModelChoice;
  ollamaEnabled: boolean;
  ollamaHost: string;
  preferOllamaForSimple: boolean;
  ollamaModel: string;
  perThreadModel: Record<string, string>;
  connectors: ConnectorSettings;
  vault: VaultSettings;
  permissions: PermissionSettings;
  /**
   * Master "auto-everything" override. When true the renderer treats every
   * permission as 'auto' regardless of the per-action stored value. Defaults
   * to true for new installs.
   */
  allPermissionsAuto: boolean;
  theme: 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'auto',
  ollamaEnabled: false,
  ollamaHost: 'http://localhost:11434',
  preferOllamaForSimple: false,
  ollamaModel: '',
  perThreadModel: {},
  connectors: {
    firecrawl: { enabled: false, apiKey: '' },
    github: { enabled: false, token: '' },
    vercel: { enabled: false, token: '' },
  },
  vault: {
    enabled: false,
    localPath: '',
    syncInterval: 60_000,
  },
  permissions: {
    vaultWrite: 'ask',
    telegramSend: 'auto',
    webSearch: 'auto',
    githubAccess: 'auto',
    shellExec: 'block',
  },
  allPermissionsAuto: true,
  theme: 'dark',
};

export interface OllamaDetectResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export const settingsApi = {
  get: () => window.nordrise.invoke<AppSettings>('settings:get'),
  set: (patch: Partial<AppSettings>) =>
    window.nordrise.invoke<AppSettings>('settings:set', patch),
  reset: () => window.nordrise.invoke<AppSettings>('settings:reset'),
};

export const ollamaApi = {
  detect: (host: string) =>
    window.nordrise.invoke<OllamaDetectResult>('ollama:detect', host),
  listModels: (host: string) =>
    window.nordrise.invoke<string[]>('ollama:list-models', host),
};

export const shellApi = {
  openExternal: (url: string) =>
    window.nordrise.invoke<boolean>('shell:open-external', url),
};

/**
 * Build the per-message connector key payload from current settings.
 * Returns undefined when no connector is enabled with a valid value, so the
 * caller can omit the field entirely (matches optional zod schema).
 */
export function buildConnectorKeys(
  settings: AppSettings,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const fc = settings.connectors?.firecrawl;
  if (fc?.enabled && fc.apiKey.trim()) {
    out.FIRECRAWL_API_KEY = fc.apiKey.trim();
  }
  const gh = settings.connectors?.github;
  if (gh?.enabled && gh.token.trim()) {
    out.GITHUB_PERSONAL_ACCESS_TOKEN = gh.token.trim();
  }
  const vc = settings.connectors?.vercel;
  if (vc?.enabled && vc.token.trim()) {
    out.VERCEL_TOKEN = vc.token.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Returns the EFFECTIVE permission mode for a given action, honouring the
 * `allPermissionsAuto` master override. The stored per-action value is
 * preserved untouched in `settings.permissions` so toggling the global flag
 * off reveals it again.
 */
export function effectivePermission(
  settings: AppSettings,
  key: keyof PermissionSettings,
): PermissionMode {
  if (settings.allPermissionsAuto) return 'auto';
  return settings.permissions[key];
}

/**
 * Human-friendly short label for a model id used in the chip and dropdowns.
 */
export function modelLabel(id: string): string {
  if (id === 'auto') return 'Auto';
  if (id === 'claude-opus-4-7') return 'Opus';
  if (id === 'claude-sonnet-4-6') return 'Sonnet';
  if (id === 'claude-haiku-4-5') return 'Haiku';
  if (id.startsWith('ollama:')) return `Ollama: ${id.slice('ollama:'.length)}`;
  return id;
}
