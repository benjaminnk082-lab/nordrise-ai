import { safeStorage, app } from 'electron';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';

const SERVICE = 'nordrise-control';
const ACCOUNT = 'bearer';

let keytarMod: typeof import('keytar') | null = null;
let keytarLoaded = false;
async function tryKeytar() {
  if (keytarLoaded) return keytarMod;
  keytarLoaded = true;
  try {
    keytarMod = await import('keytar');
  } catch {
    keytarMod = null;
  }
  return keytarMod;
}

export async function setToken(token: string): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.setPassword(SERVICE, ACCOUNT, token); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('no_secure_storage');
  const blob = safeStorage.encryptString(token);
  const path = join(app.getPath('userData'), 'token.bin');
  await writeFile(path, blob);
}

export async function getToken(): Promise<string | null> {
  const k = await tryKeytar();
  if (k) return k.getPassword(SERVICE, ACCOUNT);
  try {
    const path = join(app.getPath('userData'), 'token.bin');
    const blob = await readFile(path);
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(blob);
  } catch {
    return null;
  }
}

export async function deleteToken(): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.deletePassword(SERVICE, ACCOUNT); return; }
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(join(app.getPath('userData'), 'token.bin'));
  } catch { /* idempotent */ }
}
