import { BrowserWindow } from 'electron';
import { miniPopupWindowOptions } from './windows.js';

let popupWin: BrowserWindow | null = null;
let preloadPath: string | null = null;

export function setPopupPreloadPath(p: string): void {
  preloadPath = p;
}

export function showPopup(): void {
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.show();
    popupWin.focus();
    return;
  }
  if (!preloadPath) return;
  popupWin = new BrowserWindow(miniPopupWindowOptions(preloadPath));

  if (process.env.NODE_ENV === 'development') {
    void popupWin.loadURL('http://localhost:4001/popup');
  } else {
    void popupWin.loadURL('app://-/popup/index.html');
  }
  popupWin.once('ready-to-show', () => {
    popupWin?.show();
    popupWin?.focus();
  });
  popupWin.on('blur', () => popupWin?.hide());
  popupWin.on('closed', () => {
    popupWin = null;
  });
}

export function hidePopup(): void {
  if (popupWin && !popupWin.isDestroyed()) popupWin.hide();
}

export function getPopupWindow(): BrowserWindow | null {
  return popupWin;
}
