import { ipcMain } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';

const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';

export function registerIpc(): void {
  ipcMain.handle('auth:get-token', () => getToken());
  ipcMain.handle('auth:set-token', (_e, token: string) => setToken(token));
  ipcMain.handle('auth:delete-token', () => deleteToken());

  ipcMain.handle('config:backend-url', () => process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND);

  ipcMain.handle('healthz', async () => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const r = await fetch(`${backend}/healthz`);
    return { status: r.status, body: await r.json().catch(() => null) };
  });
}
