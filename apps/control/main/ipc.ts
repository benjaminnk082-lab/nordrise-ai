import { ipcMain } from 'electron';
import { setToken, getToken, deleteToken } from './keychain.js';

const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';
const TOKEN_SLOT = 'bearer';

export function registerIpc(): void {
  ipcMain.handle('auth:get-token', () => getToken(TOKEN_SLOT));
  ipcMain.handle('auth:set-token', (_e, token: string) => setToken(TOKEN_SLOT, token));
  ipcMain.handle('auth:clear-token', () => deleteToken(TOKEN_SLOT));

  ipcMain.handle('config:backend-url', () => process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND);

  ipcMain.handle('healthz', async () => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    try {
      const r = await fetch(`${backend}/healthz`);
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch (err) {
      return { status: 0, body: null, error: String((err as Error).message) };
    }
  });

  ipcMain.handle('auth:verify-token', async (_e, token: string) => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    try {
      const r = await fetch(`${backend}/control/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { ok: r.ok, status: r.status };
    } catch (err) {
      return { ok: false, status: 0, error: String((err as Error).message) };
    }
  });
}
