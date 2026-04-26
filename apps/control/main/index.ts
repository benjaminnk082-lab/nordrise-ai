import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mainWindowOptions } from './windows.js';
import { registerIpc } from './ipc.js';
import { initTray, setTrayStatus } from './tray.js';
import { initAutoUpdate } from './autoUpdate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWin: BrowserWindow | null = null;

function preloadPath(): string {
  return join(__dirname, '..', 'preload', 'index.js');
}

async function createMainWindow() {
  mainWin = new BrowserWindow(mainWindowOptions(preloadPath()));

  // Show the window after a hard timeout so a renderer-load failure doesn't leave it invisible.
  const showFallback = setTimeout(() => {
    if (mainWin && !mainWin.isVisible()) mainWin.show();
  }, 3_000);

  mainWin.once('ready-to-show', () => {
    clearTimeout(showFallback);
    mainWin?.show();
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWin.loadURL('http://localhost:4001');
  } else {
    // loadFile handles Windows paths with spaces; loadURL('file://...') doesn't reliably.
    await mainWin.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWin.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('renderer failed to load', { errorCode, errorDescription, validatedURL });
  });

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
  initAutoUpdate();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
