import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mainWindowOptions } from './windows.js';
import { registerIpc } from './ipc.js';
import { initTray, setTrayStatus } from './tray.js';

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

app.whenReady().then(async () => {
  registerIpc();
  await createMainWindow();
  initTray(() => mainWin);
  setInterval(async () => {
    try {
      const url = process.env.NORDRISE_BACKEND_URL ?? 'https://sean-production-4fcf.up.railway.app';
      const r = await fetch(`${url}/healthz`);
      const body = (await r.json()) as { authMode?: string; db?: string };
      if (r.status === 200 && body.authMode === 'subscription' && body.db === 'ok') setTrayStatus('green');
      else setTrayStatus('yellow');
    } catch {
      setTrayStatus('red');
    }
  }, 30_000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
