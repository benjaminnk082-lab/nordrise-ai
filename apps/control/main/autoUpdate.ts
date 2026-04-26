// electron-updater is CommonJS — import as default and destructure to satisfy NodeNext ESM.
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { app } from 'electron';

const HOUR_MS = 60 * 60 * 1000;

let pendingUpdateVersion: string | null = null;

export function initAutoUpdate(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('error', (err) => {
    console.warn('[autoUpdate] error:', err?.message ?? err);
  });
  autoUpdater.on('checking-for-update', () => {
    console.log('[autoUpdate] checking…');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[autoUpdate] update available:', info.version);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[autoUpdate] up to date');
  });
  autoUpdater.on('download-progress', (p) => {
    console.log(`[autoUpdate] downloading ${Math.round(p.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info.version;
    console.log(`[autoUpdate] downloaded ${info.version} — will install when app quits`);
    // Do NOT prompt; user wanted silent quit-and-install behaviour.
    // autoInstallOnAppQuit takes care of running the installer on app.quit().
  });

  // Initial check on boot, then every hour while the app is running.
  void autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), HOUR_MS);
}

export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}
