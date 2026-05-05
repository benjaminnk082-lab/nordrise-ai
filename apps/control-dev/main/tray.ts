import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type TrayStatus = 'green' | 'yellow' | 'red';

let tray: Tray | null = null;

function iconPath(status: TrayStatus): string {
  return join(__dirname, '..', 'assets', `tray-${status}.png`);
}

export function initTray(getMainWindow: () => BrowserWindow | null): void {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(iconPath('green')));
  tray.setToolTip('Nordrise Control');
  refreshMenu(getMainWindow);
  tray.on('click', () => {
    const w = getMainWindow();
    if (w) { w.show(); w.focus(); }
  });
}

export function setTrayStatus(status: TrayStatus): void {
  if (!tray) return;
  tray.setImage(nativeImage.createFromPath(iconPath(status)));
}

function refreshMenu(getMainWindow: () => BrowserWindow | null): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Åpne', click: () => { const w = getMainWindow(); w?.show(); w?.focus(); } },
    { type: 'separator' },
    { label: 'Avslutt', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}
