// electron-updater is CommonJS — import as default and destructure to satisfy NodeNext ESM.
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { dialog, app } from 'electron';

export function initAutoUpdate(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => console.warn('autoUpdate error', err));
  autoUpdater.on('update-available', (info) => console.log('update available', info.version));
  autoUpdater.on('update-downloaded', async () => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart nå', 'Senere'],
      defaultId: 0,
      title: 'Nordrise Control oppdatering',
      message: 'En ny versjon er lastet ned. Restart for å installere.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall();
  });
  void autoUpdater.checkForUpdatesAndNotify();
}
