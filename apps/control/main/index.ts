import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mainWindowOptions } from './windows.js';
import { registerIpc } from './ipc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWin: BrowserWindow | null = null;

function preloadPath(): string {
  return join(__dirname, '..', 'preload', 'index.js');
}

function rendererURL(): string {
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:4001';
  }
  return `file://${join(__dirname, '..', 'renderer', 'index.html')}`;
}

async function createMainWindow() {
  mainWin = new BrowserWindow(mainWindowOptions(preloadPath()));
  await mainWin.loadURL(rendererURL());
  mainWin.once('ready-to-show', () => mainWin?.show());
  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(() => {
  registerIpc();
  return createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
