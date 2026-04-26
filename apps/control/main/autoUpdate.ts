// electron-updater is CommonJS — import as default and destructure to satisfy NodeNext ESM.
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { app, BrowserWindow } from 'electron';

const HOUR_MS = 60 * 60 * 1000;

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string; checkedAt: number }
  | { kind: 'disabled-dev' };

let status: UpdateStatus = { kind: 'idle' };
let pendingUpdateVersion: string | null = null;
const log: string[] = [];

function pushLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  const entry = `[${ts}] ${line}`;
  log.push(entry);
  if (log.length > 200) log.shift();
  console.log(entry);
}

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('app:update-status', status);
  }
}

function setStatus(s: UpdateStatus): void {
  status = s;
  broadcast();
}

export function initAutoUpdate(): void {
  if (!app.isPackaged) {
    setStatus({ kind: 'disabled-dev' });
    pushLog('disabled (running in dev — app.isPackaged=false)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('error', (err) => {
    const msg = err?.stack ?? err?.message ?? String(err);
    pushLog(`error: ${msg}`);
    setStatus({ kind: 'error', message: err?.message ?? String(err), checkedAt: Date.now() });
  });
  autoUpdater.on('checking-for-update', () => {
    pushLog('checking for update…');
    setStatus({ kind: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    pushLog(`update available: ${info.version}`);
    setStatus({ kind: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    pushLog(`up to date (latest: ${info?.version ?? 'unknown'})`);
    setStatus({ kind: 'up-to-date', checkedAt: Date.now() });
  });
  autoUpdater.on('download-progress', (p) => {
    pushLog(`downloading ${Math.round(p.percent)}% (${Math.round(p.transferred/1e6)}/${Math.round(p.total/1e6)}MB)`);
    setStatus({ kind: 'downloading', percent: p.percent, transferred: p.transferred, total: p.total });
  });
  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version;
    pushLog(`downloaded ${info.version} — ready to install`);
    setStatus({ kind: 'downloaded', version: info.version });
    // Also push the legacy event for components still subscribed to it.
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('app:update-downloaded', { version: info.version });
    }
  });

  void autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), HOUR_MS);
}

export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function getUpdateLog(): string[] {
  return [...log];
}

export async function manualCheck(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    setStatus({ kind: 'disabled-dev' });
    return status;
  }
  try {
    pushLog('manual check requested');
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    pushLog(`manual check failed: ${message}`);
    setStatus({ kind: 'error', message, checkedAt: Date.now() });
  }
  return status;
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall(false, true);
}
