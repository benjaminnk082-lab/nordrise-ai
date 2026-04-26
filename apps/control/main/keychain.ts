import { safeStorage, app } from 'electron';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';

const SERVICE = 'nordrise-control';

type KeytarApi = typeof import('keytar');
let keytarMod: KeytarApi | null = null;
let keytarLoaded = false;
async function tryKeytar(): Promise<KeytarApi | null> {
  if (keytarLoaded) return keytarMod;
  keytarLoaded = true;
  try {
    // keytar is CommonJS — under NodeNext ESM the default export holds the
    // real bindings. Some bundlers also expose them at the namespace root.
    const raw = (await import('keytar')) as unknown as Record<string, unknown> & { default?: KeytarApi };
    const candidate = (raw.default ?? raw) as KeytarApi;
    if (typeof candidate.setPassword === 'function') {
      keytarMod = candidate;
    } else {
      keytarMod = null;
    }
  } catch {
    keytarMod = null;
  }
  return keytarMod;
}

function fallbackPath(account: string): string {
  // Sanitize account so it can't escape userData (defensive — names come from typed enum).
  const safe = account.replace(/[^a-zA-Z0-9_:-]/g, '_');
  return join(app.getPath('userData'), `token-${safe}.bin`);
}

export async function setToken(account: string, token: string): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.setPassword(SERVICE, account, token); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('no_secure_storage');
  const blob = safeStorage.encryptString(token);
  await writeFile(fallbackPath(account), blob);
}

export async function getToken(account: string): Promise<string | null> {
  const k = await tryKeytar();
  if (k) return k.getPassword(SERVICE, account);
  try {
    const blob = await readFile(fallbackPath(account));
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(blob);
  } catch {
    return null;
  }
}

export async function deleteToken(account: string): Promise<void> {
  const k = await tryKeytar();
  if (k) { await k.deletePassword(SERVICE, account); return; }
  try { await unlink(fallbackPath(account)); }
  catch { /* idempotent */ }
}
