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

export async function getAppVersion(): Promise<string> {
  return window.nordrise.invoke<string>('app:version');
}

export async function getPendingUpdate(): Promise<string | null> {
  return window.nordrise.invoke<string | null>('app:pending-update');
}

export async function quitAndInstall(): Promise<void> {
  await window.nordrise.invoke<void>('app:quit-and-install');
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string; checkedAt: number }
  | { kind: 'disabled-dev' };

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return window.nordrise.invoke<UpdateStatus>('app:update-status');
}

export async function getUpdateLog(): Promise<string[]> {
  return window.nordrise.invoke<string[]>('app:update-log');
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  return window.nordrise.invoke<UpdateStatus>('app:update-check');
}

// ---------- Per-user Claude OAuth token ----------

/**
 * Read whether the user has stored their own Claude OAuth token. Returns
 * the token string itself so the renderer can decide whether to show the
 * "set" or "unset" UI state — but the value is never sent over the wire by
 * the renderer; main attaches it to /control/message internally.
 */
export async function getClaudeAuthToken(): Promise<string | null> {
  return window.nordrise.invoke<string | null>('claude-auth:get-token');
}

export async function setClaudeAuthToken(token: string): Promise<void> {
  await window.nordrise.invoke<void>('claude-auth:set-token', token);
}

export async function clearClaudeAuthToken(): Promise<void> {
  await window.nordrise.invoke<void>('claude-auth:clear-token');
}

export interface ClaudeAuthTestResult {
  ok: boolean;
  error?: string;
}

export async function testClaudeAuthToken(token: string): Promise<ClaudeAuthTestResult> {
  return window.nordrise.invoke<ClaudeAuthTestResult>(
    'claude-auth:test',
    token,
  );
}

// ---------- Window chrome ----------

/**
 * Apply the user's preferred opacity to the host BrowserWindow. Clamped
 * server-side to [0.7, 1.0]. Cosmetic only — does not affect behaviour.
 */
export async function setWindowOpacity(opacity: number): Promise<boolean> {
  return window.nordrise.invoke<boolean>('window:set-opacity', opacity);
}

/**
 * Open a local file path with the OS default app. Used to open vault
 * markdown specs in the user's preferred editor (Obsidian on dev box,
 * Notepad fallback elsewhere). Returns false if the path was invalid.
 */
export async function openPath(path: string): Promise<boolean> {
  return window.nordrise.invoke<boolean>('shell:open-path', path);
}
