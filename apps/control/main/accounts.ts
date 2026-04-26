import { app } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type AccountName = 'Benjamin' | 'Martin';
export const ACCOUNT_NAMES: AccountName[] = ['Benjamin', 'Martin'];

interface AccountRecord { passwordHash: string }
interface AccountsFile {
  Benjamin?: AccountRecord;
  Martin?: AccountRecord;
}

function filePath(): string { return join(app.getPath('userData'), 'accounts.json'); }

// NOTE: SHA-256 (no salt, no iteration) is "ok-for-single-user-PC" on a trusted desktop
// — NOT real password security. The threat model here is "casual local access", not a
// motivated attacker who has copied accounts.json off the disk. Passwords are short
// (4+ chars) and used only to gate access to a bearer token already protected by keytar
// / safeStorage. Do not reuse this for anything resembling multi-tenant auth.
function hashPwd(pwd: string): string { return createHash('sha256').update(pwd).digest('hex'); }

export async function readAccounts(): Promise<AccountsFile> {
  try { return JSON.parse(await readFile(filePath(), 'utf8')) as AccountsFile; }
  catch { return {}; }
}

async function writeAccounts(data: AccountsFile): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(filePath(), JSON.stringify(data, null, 2));
}

export async function isSetupComplete(): Promise<boolean> {
  const a = await readAccounts();
  return !!a.Benjamin && !!a.Martin;
}

export async function setupAccounts(input: { name: AccountName; password: string }[]): Promise<void> {
  const a = await readAccounts();
  for (const { name, password } of input) a[name] = { passwordHash: hashPwd(password) };
  await writeAccounts(a);
}

export async function verifyPassword(name: AccountName, password: string): Promise<boolean> {
  const a = await readAccounts();
  const r = a[name];
  if (!r) return false;
  return r.passwordHash === hashPwd(password);
}
