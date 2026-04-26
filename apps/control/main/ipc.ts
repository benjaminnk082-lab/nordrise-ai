import { ipcMain } from 'electron';
import { setToken, getToken } from './keychain.js';
import {
  isSetupComplete,
  setupAccounts,
  verifyPassword,
  type AccountName,
} from './accounts.js';

const DEFAULT_BACKEND = 'https://sean-production-4fcf.up.railway.app';

interface SetupPayloadEntry { name: AccountName; password: string; token: string }
interface LoginPayload { name: AccountName; password: string }

export function registerIpc(): void {
  ipcMain.handle('accounts:setup-status', () => isSetupComplete());

  ipcMain.handle('accounts:setup', async (_e, payload: SetupPayloadEntry[]) => {
    await setupAccounts(payload.map(({ name, password }) => ({ name, password })));
    for (const { name, token } of payload) {
      await setToken(`bearer:${name}`, token);
    }
  });

  ipcMain.handle('accounts:login', async (_e, payload: LoginPayload) => {
    const ok = await verifyPassword(payload.name, payload.password);
    if (!ok) return { ok: false as const };
    const token = await getToken(`bearer:${payload.name}`);
    if (!token) return { ok: false as const, error: 'no-token' };
    return { ok: true as const, token };
  });

  // Logout is purely client-side (renderer drops the token from memory).
  ipcMain.handle('accounts:logout', () => { /* no-op */ });

  ipcMain.handle('config:backend-url', () => process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND);

  ipcMain.handle('healthz', async () => {
    const backend = process.env.NORDRISE_BACKEND_URL ?? DEFAULT_BACKEND;
    const r = await fetch(`${backend}/healthz`);
    return { status: r.status, body: await r.json().catch(() => null) };
  });
}
