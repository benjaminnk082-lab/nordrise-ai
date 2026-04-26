// Renderer-side bridge for Obsidian-vault sync.
// All real work happens in main; this just wraps `window.nordrise.invoke`.

export interface VaultStatus {
  enabled: boolean;
  lastSyncAt: number;
  fileCount: number;
  pending: number;
  error?: string;
  root?: string;
}

export interface SeanNote {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export const vaultApi = {
  status: () => window.nordrise.invoke<VaultStatus>('vault:status'),
  start: (path: string) => window.nordrise.invoke<void>('vault:start', path),
  stop: () => window.nordrise.invoke<void>('vault:stop'),
  resync: (path: string) => window.nordrise.invoke<void>('vault:resync', path),
  pickFolder: () =>
    window.nordrise.invoke<string | null>('vault:pick-folder'),
  listSeanNotes: () => window.nordrise.invoke<SeanNote[]>('vault:list-sean-notes'),
  adoptNote: (path: string, vaultRoot: string) =>
    window.nordrise.invoke<{ savedTo: string }>('vault:adopt-note', {
      path,
      vaultRoot,
    }),
  dismissNote: (path: string) =>
    window.nordrise.invoke<void>('vault:dismiss-note', path),
};

/**
 * "n sek/min/timer/dager siden" — small helper used in vault status and
 * Sean-note cards. Returns "—" when ts is 0.
 */
export function formatRelative(ts: number): string {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 0) return 'nå';
  const sec = Math.round(d / 1000);
  if (sec < 60) return `${sec}s siden`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m siden`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}t siden`;
  const day = Math.round(hr / 24);
  return `${day}d siden`;
}
