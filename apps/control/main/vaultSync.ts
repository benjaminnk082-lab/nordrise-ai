/**
 * vaultSync.ts — Obsidian-vault sync engine running in the Electron main process.
 *
 * One-way sync: PC -> backend.
 *  - Initial walk uploads anything that doesn't match the backend's manifest.
 *  - chokidar watcher reacts to add/change/unlink with batched uploads.
 *  - Status broadcasts via `vault:status` IPC channel.
 *
 * Suggestion-back: Sean writes to `/app/workspace/sean-notes/` on the backend.
 *  - `listSeanNotes()` polls the queue.
 *  - `adoptSeanNote()` writes the file to <vault>/Sean/<filename>, then
 *    DELETEs from the server queue.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { net, BrowserWindow } from 'electron';
import { getToken } from './keychain.js';

const TOKEN_SLOT = 'bearer';
const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';

function backendUrl(): string {
  return process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
}

export interface SyncStats {
  enabled: boolean;
  lastSyncAt: number;
  fileCount: number;
  pending: number;
  error?: string;
  /** Currently watched root, for debugging. */
  root?: string;
}

let watcher: FSWatcher | null = null;
let syncing = false;
const pendingFiles = new Set<string>();
let pendingTimer: NodeJS.Timeout | null = null;

let stats: SyncStats = {
  enabled: false,
  lastSyncAt: 0,
  fileCount: 0,
  pending: 0,
};

function broadcast(): void {
  const payload = { ...stats };
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('vault:status', payload);
  }
}

function setError(err: unknown): void {
  stats = { ...stats, error: (err as Error)?.message ?? String(err) };
  broadcast();
}

function clearError(): void {
  if (stats.error !== undefined) {
    const next = { ...stats };
    delete next.error;
    stats = next;
    broadcast();
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function uploadFile(localPath: string, vaultRoot: string): Promise<void> {
  const token = await getToken(TOKEN_SLOT);
  if (!token) throw new Error('no_token');
  const rel = relative(vaultRoot, localPath).replace(/\\/g, '/');
  const buf = await readFile(localPath);
  // FormData/Blob are globals in Node 20+. tsconfig.main.json doesn't include
  // the DOM lib, hence the `any` cast (matches the pattern in ipc.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FD = (globalThis as any).FormData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BlobCtor = (globalThis as any).Blob;
  const fd = new FD();
  fd.append('path', rel);
  fd.append('file', new BlobCtor([buf], { type: 'application/octet-stream' }), rel.split('/').pop() ?? 'file');
  const r = await net.fetch(`${backendUrl()}/control/vault/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`upload ${rel}: ${r.status}`);
}

async function deleteRemoteFile(rel: string): Promise<void> {
  const token = await getToken(TOKEN_SLOT);
  if (!token) throw new Error('no_token');
  const url = `${backendUrl()}/control/vault/files?path=${encodeURIComponent(rel)}`;
  await net.fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

interface RemoteEntry {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

async function getRemoteManifest(): Promise<{ files: RemoteEntry[] }> {
  const token = await getToken(TOKEN_SLOT);
  if (!token) throw new Error('no_token');
  const r = await net.fetch(`${backendUrl()}/control/vault/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`manifest ${r.status}`);
  return r.json() as Promise<{ files: RemoteEntry[] }>;
}

interface LocalEntry {
  path: string;
  sha256: string;
}

async function walkLocal(dir: string, base: string): Promise<LocalEntry[]> {
  const out: LocalEntry[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkLocal(full, base)));
    } else if (e.isFile()) {
      try {
        const buf = await readFile(full);
        out.push({
          path: relative(base, full).replace(/\\/g, '/'),
          sha256: sha256(buf),
        });
      } catch {
        // skip unreadable
      }
    }
  }
  return out;
}

/**
 * Idempotent full sync: upload anything missing or changed, delete remote
 * files no longer present locally. Safe to call repeatedly.
 */
export async function fullSync(vaultRoot: string): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const [local, remote] = await Promise.all([
      walkLocal(vaultRoot, vaultRoot),
      getRemoteManifest(),
    ]);
    const remoteMap = new Map(remote.files.map((f) => [f.path, f.sha256]));
    const localMap = new Map(local.map((f) => [f.path, f.sha256]));

    for (const f of local) {
      if (remoteMap.get(f.path) !== f.sha256) {
        await uploadFile(join(vaultRoot, f.path), vaultRoot);
      }
    }
    for (const f of remote.files) {
      if (!localMap.has(f.path)) {
        await deleteRemoteFile(f.path);
      }
    }

    stats = {
      ...stats,
      lastSyncAt: Date.now(),
      fileCount: local.length,
      pending: 0,
    };
    clearError();
    broadcast();
  } catch (err) {
    setError(err);
  } finally {
    syncing = false;
  }
}

function scheduleSync(vaultRoot: string): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  stats = { ...stats, pending: pendingFiles.size };
  broadcast();
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    const files = [...pendingFiles];
    pendingFiles.clear();
    for (const f of files) {
      try {
        await uploadFile(f, vaultRoot);
      } catch (err) {
        setError(err);
      }
    }
    stats = { ...stats, lastSyncAt: Date.now(), pending: 0 };
    broadcast();
  }, 1500);
}

/**
 * chokidar's `ignored` predicate. Skips dot-folders (`.obsidian`, `.git`),
 * Vim swap files, and tilde-prefixed temp files. Cross-platform — checks
 * both `\\` and `/` separators.
 */
function shouldIgnore(p: string): boolean {
  // Hide any segment that starts with a dot. Match against both slash flavours
  // because chokidar passes native paths on Windows.
  if (/[\\/]\.[^\\/]+/.test(p)) return true;
  if (/^\.[^\\/]+/.test(p)) return true;
  if (p.endsWith('.swp') || p.endsWith('.swo') || p.endsWith('~')) return true;
  return false;
}

export async function startVaultSync(vaultRoot: string): Promise<void> {
  await stopVaultSync();
  if (!vaultRoot || vaultRoot.trim().length === 0) {
    setError(new Error('no vault path'));
    return;
  }

  stats = { ...stats, enabled: true, root: vaultRoot };
  clearError();
  broadcast();

  await fullSync(vaultRoot);

  watcher = chokidar.watch(vaultRoot, {
    ignoreInitial: true,
    ignored: shouldIgnore,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });
  watcher.on('add', (p: string) => {
    pendingFiles.add(p);
    scheduleSync(vaultRoot);
  });
  watcher.on('change', (p: string) => {
    pendingFiles.add(p);
    scheduleSync(vaultRoot);
  });
  watcher.on('unlink', async (p: string) => {
    const rel = relative(vaultRoot, p).replace(/\\/g, '/');
    try {
      await deleteRemoteFile(rel);
      stats = { ...stats, lastSyncAt: Date.now() };
      broadcast();
    } catch (err) {
      setError(err);
    }
  });
  watcher.on('error', (err) => setError(err));
}

export async function stopVaultSync(): Promise<void> {
  if (watcher) {
    try {
      await watcher.close();
    } catch {
      // ignore
    }
    watcher = null;
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingFiles.clear();
  stats = { ...stats, enabled: false, pending: 0 };
  broadcast();
}

export function getVaultStatus(): SyncStats {
  return { ...stats };
}

export interface SeanNote {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

export async function listSeanNotes(): Promise<SeanNote[]> {
  const token = await getToken(TOKEN_SLOT);
  if (!token) return [];
  try {
    const r = await net.fetch(`${backendUrl()}/control/vault/sean-notes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { notes?: SeanNote[] };
    return j.notes ?? [];
  } catch {
    return [];
  }
}

/**
 * Copy a Sean-proposed note into the local vault under `<vault>/Sean/<path>`,
 * then dismiss it from the server queue. Throws if the note is not found.
 */
export async function adoptSeanNote(
  notePath: string,
  vaultRoot: string,
): Promise<{ savedTo: string }> {
  if (!vaultRoot) throw new Error('no_vault_root');
  const notes = await listSeanNotes();
  const note = notes.find((n) => n.path === notePath);
  if (!note) throw new Error('note_not_found');
  const target = join(vaultRoot, 'Sean', notePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, note.content, 'utf8');

  const token = await getToken(TOKEN_SLOT);
  if (token) {
    await net.fetch(
      `${backendUrl()}/control/vault/sean-notes?path=${encodeURIComponent(notePath)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
  }
  return { savedTo: target };
}

export async function dismissSeanNote(notePath: string): Promise<void> {
  const token = await getToken(TOKEN_SLOT);
  if (!token) return;
  await net.fetch(
    `${backendUrl()}/control/vault/sean-notes?path=${encodeURIComponent(notePath)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}
