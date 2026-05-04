/**
 * settingsStore.ts — small JSON-backed app-settings store.
 *
 * A separate file (settings.json) under app.getPath('userData') is simpler than
 * sharing the better-sqlite3 instance with quick-tasks: settings is read on
 * almost every send, atomic writes via fs.writeFileSync are good enough at
 * this volume, and we don't want a schema migration if the shape evolves.
 */
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

/**
 * Selected default model. `auto` enables the routing heuristic in the renderer.
 * Per-thread overrides live in `perThreadModel` (keyed by control session id)
 * and may also hold the synthetic `ollama:<model>` form.
 */
export type DefaultModelChoice = ClaudeModelId | 'auto';

/**
 * MCP connectors. Keys live LOCAL-ONLY here on the user's PC and travel
 * ephemerally per request body to Sean. Never persisted backend-side.
 *
 * v0.5.0 added the school/work trio:
 *   - teams: Microsoft 365 / Teams via MS Graph (chats, mail, calendar)
 *   - itslearning: school LMS (assignments, grades, submissions)
 *   - visma: Visma InSchool (timetable, absences, school messages)
 *
 * Teams uses a refresh token (long-lived OAuth grant). The desktop main
 * process exchanges it for short-lived access tokens before each call —
 * the renderer/server only ever sees the refresh token slot.
 *
 * Itslearning uses a per-school OAuth client (clientId + clientSecret + a
 * tenant subdomain like "oslo.itslearning.com"). Secret stored locally only.
 *
 * Visma has no public API for students — we authenticate by capturing the
 * user's session cookie via a one-time embedded login. `cookie` is the raw
 * `JSESSIONID=...` value harvested after login. May expire; user re-logs in.
 */
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

/**
 * Obsidian-vault sync settings.
 * - `localPath` is an absolute path on Benjamin's PC.
 * - `syncInterval` polls the sean-notes endpoint to surface new proposals.
 *   The actual file watcher (chokidar) reacts in real time; this is just for
 *   the suggestion-back queue.
 */
export interface VaultSettings {
  enabled: boolean;
  localPath: string;
  syncInterval: number;
}

/**
 * Permission policy per action class.
 *
 * - `auto`   — Sean / the desktop runs the action without confirmation.
 * - `ask`    — user must approve in the UI before the action runs.
 * - `block`  — action is denied outright.
 *
 * In v0.2.3 only `vaultWrite` is enforced client-side (it gates the
 * sean-notes auto-merger). The other entries are persisted today so the user
 * can express intent, and v0.2.4 will plumb them through to the backend so
 * Sean's tool calls respect them too.
 */
export type PermissionMode = 'auto' | 'ask' | 'block';

export interface PermissionSettings {
  /** Auto-copy `/app/workspace/sean-notes/` files into `<vault>/Sean/`. */
  vaultWrite: PermissionMode;
  /** TODO(v0.2.4): backend-enforced. Routine notifications via Telegram. */
  telegramSend: PermissionMode;
  /** TODO(v0.2.4): backend-enforced. Firecrawl scrape/search calls. */
  webSearch: PermissionMode;
  /** TODO(v0.2.4): backend-enforced. GitHub MCP read access. */
  githubAccess: PermissionMode;
  /** TODO(v0.2.4): backend-enforced. Shell exec. Reserved — default block. */
  shellExec: PermissionMode;
}

export interface AppSettings {
  defaultModel: DefaultModelChoice;
  ollamaEnabled: boolean;
  ollamaHost: string;
  /** When auto-routing, prefer Ollama for messages classified "simple". */
  preferOllamaForSimple: boolean;
  ollamaModel: string;
  /** controlSessionId -> model id (Claude id, "auto", or "ollama:<name>"). */
  perThreadModel: Record<string, string>;
  connectors: ConnectorSettings;
  vault: VaultSettings;
  permissions: PermissionSettings;
  /**
   * Three-way permission mode (Claude Code-style), introduced in v0.5.1:
   *
   *   - 'auto'   — Sean executes every action without confirmation.
   *                Ideal for trusted single-user setup. Default for new installs.
   *   - 'manual' — Sean asks before every action, regardless of per-action values.
   *                Mirrors Claude Code's "default" mode. Best for review-heavy
   *                workflows or when you're handing the app to someone new.
   *   - 'custom' — Per-action mode in `permissions` is honored exactly as-is.
   *                Use this when you want fine-grained control (e.g. auto for
   *                webSearch, ask for githubAccess, block for shellExec).
   *
   * `allPermissionsAuto` is preserved for backward-compat: settings.json files
   * written by v0.5.0 or earlier set the legacy boolean; on load we migrate
   * `true → 'auto'` and `false → 'custom'`. New writes always set both fields.
   */
  permissionMode: 'auto' | 'manual' | 'custom';
  /**
   * @deprecated v0.5.1 — use `permissionMode` instead. Kept on disk so a
   * downgrade to v0.5.0 still reads sensible defaults. New code should never
   * read this directly; use `effectivePermission()` or `permissionMode`.
   */
  allPermissionsAuto: boolean;
  /**
   * UI theme preset. Applied via `data-theme` on the <html> element so CSS
   * variables can swap colors. `compact` reuses dark colors but tightens
   * structural padding/sizing.
   */
  theme: 'dark' | 'light' | 'solar' | 'cyberpunk' | 'compact';
  /**
   * Window opacity (0.7-1.0). Applied via Electron's BrowserWindow.setOpacity()
   * — purely cosmetic. Outside the range is clamped on apply.
   */
  windowOpacity: number;
}

function defaultVaultPath(): string {
  // Default candidate; only used if the folder actually exists. Otherwise we
  // leave the field empty so the picker shows immediately.
  try {
    const candidate = join(homedir(), 'Documents', 'ObsidianVault');
    return existsSync(candidate) ? candidate : '';
  } catch {
    return '';
  }
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
    localPath: defaultVaultPath(),
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

let cached: AppSettings | null = null;
let pathCache: string | null = null;

function settingsPath(): string {
  if (pathCache) return pathCache;
  pathCache = join(app.getPath('userData'), 'settings.json');
  return pathCache;
}

function load(): AppSettings {
  if (cached) return cached;
  const file = settingsPath();
  if (!existsSync(file)) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Migrate v0.5.0-and-earlier files: when the new `permissionMode` field
    // is missing, derive it from the legacy `allPermissionsAuto` boolean so
    // the user's existing intent (autonomous vs per-action) is preserved.
    let migratedMode: AppSettings['permissionMode'];
    if (parsed.permissionMode) {
      migratedMode = parsed.permissionMode;
    } else if (parsed.allPermissionsAuto === false) {
      migratedMode = 'custom';
    } else {
      migratedMode = 'auto';
    }
    // Merge with defaults so unknown / missing fields fall back gracefully.
    cached = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      permissionMode: migratedMode,
      allPermissionsAuto: migratedMode === 'auto',
      perThreadModel: {
        ...DEFAULT_SETTINGS.perThreadModel,
        ...(parsed.perThreadModel ?? {}),
      },
      connectors: {
        firecrawl: {
          ...DEFAULT_SETTINGS.connectors.firecrawl,
          ...(parsed.connectors?.firecrawl ?? {}),
        },
        github: {
          ...DEFAULT_SETTINGS.connectors.github,
          ...(parsed.connectors?.github ?? {}),
        },
        vercel: {
          ...DEFAULT_SETTINGS.connectors.vercel,
          ...(parsed.connectors?.vercel ?? {}),
        },
        teams: {
          ...DEFAULT_SETTINGS.connectors.teams,
          ...(parsed.connectors?.teams ?? {}),
        },
        itslearning: {
          ...DEFAULT_SETTINGS.connectors.itslearning,
          ...(parsed.connectors?.itslearning ?? {}),
        },
        visma: {
          ...DEFAULT_SETTINGS.connectors.visma,
          ...(parsed.connectors?.visma ?? {}),
        },
      },
      vault: {
        ...DEFAULT_SETTINGS.vault,
        ...(parsed.vault ?? {}),
      },
      permissions: {
        ...DEFAULT_SETTINGS.permissions,
        ...(parsed.permissions ?? {}),
      },
    };
    return cached;
  } catch {
    // Corrupt file — fall back to defaults rather than crash the app.
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
}

function persist(settings: AppSettings): void {
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

export function getSettings(): AppSettings {
  return load();
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const current = load();
  // Keep the legacy `allPermissionsAuto` mirror in sync with the new
  // `permissionMode` whenever the latter changes, so a downgrade still
  // reads a sensible value.
  const modeAfter = patch.permissionMode ?? current.permissionMode;
  const next: AppSettings = {
    ...current,
    ...patch,
    permissionMode: modeAfter,
    allPermissionsAuto: modeAfter === 'auto',
    perThreadModel: {
      ...current.perThreadModel,
      ...(patch.perThreadModel ?? {}),
    },
    connectors: {
      firecrawl: {
        ...current.connectors.firecrawl,
        ...(patch.connectors?.firecrawl ?? {}),
      },
      github: {
        ...current.connectors.github,
        ...(patch.connectors?.github ?? {}),
      },
      vercel: {
        ...current.connectors.vercel,
        ...(patch.connectors?.vercel ?? {}),
      },
      teams: {
        ...current.connectors.teams,
        ...(patch.connectors?.teams ?? {}),
      },
      itslearning: {
        ...current.connectors.itslearning,
        ...(patch.connectors?.itslearning ?? {}),
      },
      visma: {
        ...current.connectors.visma,
        ...(patch.connectors?.visma ?? {}),
      },
    },
    vault: {
      ...current.vault,
      ...(patch.vault ?? {}),
    },
    permissions: {
      ...current.permissions,
      ...(patch.permissions ?? {}),
    },
  };
  cached = next;
  persist(next);
  return next;
}

export function resetSettings(): AppSettings {
  cached = { ...DEFAULT_SETTINGS };
  persist(cached);
  return cached;
}
