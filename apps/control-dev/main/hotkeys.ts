import { globalShortcut, BrowserWindow } from 'electron';
import { showPopup } from './popup.js';

export function registerHotkeys(getMainWindow: () => BrowserWindow | null): void {
  const ok1 = globalShortcut.register('Control+Shift+S', () => showPopup());
  const ok2 = globalShortcut.register('Control+Shift+L', () => {
    const w = getMainWindow();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
  });
  if (!ok1 || !ok2) {
    console.warn('[hotkeys] one or more global shortcuts could not be registered');
  }
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
