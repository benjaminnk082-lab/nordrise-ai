import { app, BrowserWindow, protocol, net } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mainWindowOptions } from './windows.js';
import { registerIpc } from './ipc.js';
import { initTray, setTrayStatus } from './tray.js';
import { initAutoUpdate } from './autoUpdate.js';
import { setPopupPreloadPath } from './popup.js';
import { registerHotkeys, unregisterHotkeys } from './hotkeys.js';
import { getSettings } from './settingsStore.js';
import {
  startVaultSync,
  stopVaultSync,
  startSeanNotesAutoMerge,
  stopSeanNotesAutoMerge,
} from './vaultSync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Register the app:// scheme as a standard, secure scheme BEFORE app.whenReady().
// This is required so the renderer can resolve absolute Next.js paths like /_next/static/...
// which 404 under file:// protocol (browser fetches from filesystem root, not app dir).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

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
    await mainWin.loadURL('app://-/index.html');
  }

  mainWin.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('renderer failed to load', { errorCode, errorDescription, validatedURL });
  });

  mainWin.on('closed', () => { mainWin = null; });
}

app.whenReady().then(async () => {
  // Register the app:// protocol handler. Maps app://-/<path> → dist/renderer/<path>.
  // The host segment is ignored ("-" is just a placeholder; some Electron versions
  // reject empty hosts in standard URLs).
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const filePath = join(__dirname, '..', 'renderer', pathname);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  registerIpc();
  setPopupPreloadPath(preloadPath());
  await createMainWindow();
  initTray(() => mainWin);
  registerHotkeys(() => mainWin);

  // Auto-start vault sync if user previously enabled it. Failure is
  // non-fatal — error surfaces via the `vault:status` broadcast.
  try {
    const s = getSettings();
    if (s.vault.enabled && s.vault.localPath) {
      void startVaultSync(s.vault.localPath);
    }
  } catch (err) {
    console.warn('vault auto-start failed', err);
  }
  // Sean-notes auto-merger ticks every 60s and re-checks settings each tick.
  // It's a no-op when vault is disabled or vaultWrite permission != 'auto',
  // so safe to start unconditionally at boot.
  startSeanNotesAutoMerge(getSettings);
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

app.on('will-quit', () => {
  unregisterHotkeys();
  stopSeanNotesAutoMerge();
  void stopVaultSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
