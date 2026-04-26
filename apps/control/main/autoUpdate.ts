// electron-updater is CommonJS — import as default and destructure to satisfy NodeNext ESM.
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { app, BrowserWindow } from 'electron';

const HOUR_MS = 60 * 60 * 1000;

let pendingUpdateVersion: string | null = null;

export function initAutoUpdate(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  // v0.1.10: explicit user action required. The renderer shows a
  // "Versjon X er klar — Relaunch nå" banner and the user clicks to
  // install. Closing the app no longer triggers the installer.
  autoUpdater.autoInstallOnAppQuit = false;
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
    console.log(`[autoUpdate] downloaded ${info.version} — pushing notification to renderer`);
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('app:update-downloaded', { version: info.version });
    }
  });

  // Initial check on boot, then every hour while the app is running.
  void autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), HOUR_MS);
}

export function getPendingUpdateVersion(): string | null {
  return pendingUpdateVersion;
}

export function quitAndInstall(): void {
  // (isSilent=false ensures the installer is visible so the user can see
  //  it actually run; isForceRunAfter=true relaunches the app afterwards.)
  autoUpdater.quitAndInstall(false, true);
}
