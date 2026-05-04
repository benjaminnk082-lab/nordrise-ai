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
  teams: {
    enabled: boolean;
    refreshToken: string;
    clientId: string;
    tenantId: string;
  };
  itslearning: {
    enabled: boolean;
    site: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
  visma: {
    enabled: boolean;
    school: string;
    cookie: string;
  };
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

export type PermissionModeId = 'auto' | 'manual' | 'custom';

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
   * Three-way permission mode (Claude Code-style), v0.5.1+:
   *   - 'auto'   — everything autonomous
   *   - 'manual' — Sean asks before every action
   *   - 'custom' — per-action `permissions` map is honored
   */
  permissionMode: PermissionModeId;
  /** @deprecated kept for backward-compat; use `permissionMode`. */
  allPermissionsAuto: boolean;
  /**
   * UI theme preset. The layout reads this on mount and applies it via
   * `data-theme` on <html>. CSS variables in globals.css swap accordingly.
   */
  theme: ThemeId;
  /** Window opacity (0.7 .. 1.0). Applied via Electron's setOpacity in main. */
  windowOpacity: number;
}

export type ThemeId = 'dark' | 'light' | 'solar' | 'cyberpunk' | 'compact';

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
    teams: { enabled: false, refreshToken: '', clientId: '', tenantId: 'common' },
    itslearning: {
      enabled: false,
      site: '',
      clientId: '',
      clientSecret: '',
      refreshToken: '',
    },
    visma: { enabled: false, school: '', cookie: '' },
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
  permissionMode: 'auto',
  allPermissionsAuto: true,
  theme: 'dark',
  windowOpacity: 1.0,
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
  const tm = settings.connectors?.teams;
  if (tm?.enabled && tm.refreshToken.trim() && tm.clientId.trim()) {
    out.MS365_MCP_OAUTH_REFRESH_TOKEN = tm.refreshToken.trim();
    out.MS365_MCP_CLIENT_ID = tm.clientId.trim();
    out.MS365_MCP_TENANT_ID = tm.tenantId.trim() || 'common';
  }
  const il = settings.connectors?.itslearning;
  if (
    il?.enabled &&
    il.site.trim() &&
    il.clientId.trim() &&
    il.refreshToken.trim()
  ) {
    out.ITSLEARNING_SITE = il.site.trim();
    out.ITSLEARNING_CLIENT_ID = il.clientId.trim();
    out.ITSLEARNING_CLIENT_SECRET = il.clientSecret.trim();
    out.ITSLEARNING_REFRESH_TOKEN = il.refreshToken.trim();
  }
  const vs = settings.connectors?.visma;
  if (vs?.enabled && vs.school.trim() && vs.cookie.trim()) {
    out.VISMA_SCHOOL = vs.school.trim();
    out.VISMA_COOKIE = vs.cookie.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Returns the EFFECTIVE permission mode for a given action, resolving through
 * the three-way `permissionMode`:
 *   - auto   → 'auto'    (Sean acts without asking)
 *   - manual → 'ask'     (Sean confirms each action)
 *   - custom → per-action value from `settings.permissions[key]`
 *
 * The per-action stored value is preserved untouched so flipping back to
 * 'custom' restores the user's previous fine-grained policy.
 */
export function effectivePermission(
  settings: AppSettings,
  key: keyof PermissionSettings,
): PermissionMode {
  // Read permissionMode with a graceful fallback so old in-memory snapshots
  // (from before this field existed) still resolve.
  const mode: PermissionModeId =
    settings.permissionMode ??
    (settings.allPermissionsAuto ? 'auto' : 'custom');
  if (mode === 'auto') return 'auto';
  if (mode === 'manual') return 'ask';
  return settings.permissions[key];
}

/**
 * Human-readable label + short description for each permission mode.
 * Used by the settings UI, footer pill, and command palette.
 */
export const PERMISSION_MODE_META: Record<
  PermissionModeId,
  { label: string; sub: string; icon: string }
> = {
  auto: {
    label: 'Auto',
    sub: 'Sean handler uten å spørre — full tillit',
    icon: '⚡',
  },
  manual: {
    label: 'Manuell',
    sub: 'Sean spør før hver handling',
    icon: '🤚',
  },
  custom: {
    label: 'Custom',
    sub: 'Per-handling regler bestemmer',
    icon: '🎚',
  },
};

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
