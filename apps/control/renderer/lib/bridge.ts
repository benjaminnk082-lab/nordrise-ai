export type AccountName = 'Benjamin' | 'Martin';

export async function isSetupComplete(): Promise<boolean> {
  return window.nordrise.invoke<boolean>('accounts:setup-status');
}

export async function setupAccounts(
  payload: { name: AccountName; password: string; token: string }[],
): Promise<void> {
  await window.nordrise.invoke<void>('accounts:setup', payload);
}

export async function login(
  name: AccountName,
  password: string,
): Promise<{ ok: true; token: string } | { ok: false; error?: string }> {
  return window.nordrise.invoke('accounts:login', { name, password });
}

export async function logout(): Promise<void> {
  await window.nordrise.invoke<void>('accounts:logout');
}

export async function getBackendUrl(): Promise<string> {
  return window.nordrise.invoke<string>('config:backend-url');
}

export async function pingHealthz(): Promise<{ status: number; body: unknown }> {
  return window.nordrise.invoke('healthz');
}
