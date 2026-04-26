// Renderer-side bridge for app settings + Ollama detection.
// Mirror the AppSettings shape from apps/control/main/settingsStore.ts.

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export type DefaultModelChoice = ClaudeModelId | 'auto';

export interface AppSettings {
  defaultModel: DefaultModelChoice;
  ollamaEnabled: boolean;
  ollamaHost: string;
  preferOllamaForSimple: boolean;
  ollamaModel: string;
  perThreadModel: Record<string, string>;
  theme: 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'auto',
  ollamaEnabled: false,
  ollamaHost: 'http://localhost:11434',
  preferOllamaForSimple: false,
  ollamaModel: '',
  perThreadModel: {},
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
