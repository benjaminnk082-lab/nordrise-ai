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
 */
export interface ConnectorSettings {
  firecrawl: { enabled: boolean; apiKey: string };
  github: { enabled: boolean; token: string };
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
  theme: 'dark';
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
  },
  vault: {
    enabled: false,
    localPath: defaultVaultPath(),
    syncInterval: 60_000,
  },
  theme: 'dark',
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
    // Merge with defaults so unknown / missing fields fall back gracefully.
    cached = {
      ...DEFAULT_SETTINGS,
      ...parsed,
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
      },
      vault: {
        ...DEFAULT_SETTINGS.vault,
        ...(parsed.vault ?? {}),
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
  const next: AppSettings = {
    ...current,
    ...patch,
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
    },
    vault: {
      ...current.vault,
      ...(patch.vault ?? {}),
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
