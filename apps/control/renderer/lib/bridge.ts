export async function getStoredToken(): Promise<string | null> {
  return window.nordrise.invoke<string | null>('auth:get-token');
}

export async function setStoredToken(token: string): Promise<void> {
  await window.nordrise.invoke<void>('auth:set-token', token);
}

export async function clearStoredToken(): Promise<void> {
  await window.nordrise.invoke<void>('auth:clear-token');
}

export async function verifyToken(token: string): Promise<{ ok: boolean; status: number; error?: string }> {
  return window.nordrise.invoke('auth:verify-token', token);
}

export async function getBackendUrl(): Promise<string> {
  return window.nordrise.invoke<string>('config:backend-url');
}

export async function pingHealthz(): Promise<{ status: number; body: unknown; error?: string }> {
  return window.nordrise.invoke('healthz');
}
