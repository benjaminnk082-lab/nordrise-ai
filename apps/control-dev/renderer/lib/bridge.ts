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

// ---------- Frameless window controls ----------

export async function minimizeWindow(): Promise<void> {
  await window.nordrise.invoke<void>('window:minimize');
}

export async function toggleMaximizeWindow(): Promise<boolean> {
  return window.nordrise.invoke<boolean>('window:toggle-maximize');
}

export async function closeWindow(): Promise<void> {
  await window.nordrise.invoke<void>('window:close');
}

export async function isMaximized(): Promise<boolean> {
  return window.nordrise.invoke<boolean>('window:is-maximized');
}

/**
 * Subscribe to maximize/restore/full-screen state changes. Pushes a
 * `{ maximized, fullscreen }` payload whenever the OS-level state shifts
 * (so the renderer can swap the maximize icon and adjust outer-radius).
 *
 * Returns an unsubscribe function. Call once on titlebar mount.
 */
export function subscribeWindowState(
  listener: (state: { maximized: boolean; fullscreen: boolean }) => void,
): () => void {
  const off = window.nordrise.on('window:state', (s: unknown) => {
    listener(s as { maximized: boolean; fullscreen: boolean });
  });
  // Tell main to start emitting events for this window.
  void window.nordrise.invoke('window:subscribe-state');
  return off;
}

/**
 * Open a local file path with the OS default app. Used to open vault
 * markdown specs in the user's preferred editor (Obsidian on dev box,
 * Notepad fallback elsewhere). Returns false if the path was invalid.
 */
export async function openPath(path: string): Promise<boolean> {
  return window.nordrise.invoke<boolean>('shell:open-path', path);
}

// ---------- Connector OAuth flows (v0.5.2) ----------

export interface TeamsOAuthResult {
  ok: boolean;
  refreshToken?: string;
  error?: string;
}

/**
 * Run the Microsoft 365 / Teams OAuth flow. Opens the user's default browser
 * to the Microsoft sign-in page; the response is captured by a one-shot
 * localhost listener in main and the resulting refresh token is returned.
 *
 * The renderer is responsible for storing the refresh token in the connector
 * settings (typically by calling settingsApi.set with the relevant patch).
 */
export async function startTeamsOAuth(input: {
  clientId: string;
  tenantId: string;
}): Promise<TeamsOAuthResult> {
  return window.nordrise.invoke<TeamsOAuthResult>('teams:oauth-start', input);
}

export interface VismaCookieResult {
  ok: boolean;
  cookie?: string;
  error?: string;
}

/**
 * Open the Visma InSchool sign-in page in an embedded BrowserWindow.
 * The user signs in there; main detects the post-login state via the
 * cookie jar and returns the captured `Cookie:` header string.
 */
export async function captureVismaCookie(input: {
  school: string;
}): Promise<VismaCookieResult> {
  return window.nordrise.invoke<VismaCookieResult>(
    'visma:capture-cookie',
    input,
  );
}

// ============================================================
// Phase 3 — vault, skills, heartbeat, checkpoint, errors,
// lighthouse, preview. See CLAUDE.md §12 for the IPC inventory.
// ============================================================

// ---------- Vault ----------

export interface VaultCandidate {
  path: string;
  hasObsidianFolder: boolean;
  hasSeanFolder: boolean;
}

export const phase3Vault = {
  detectCandidates: () =>
    window.nordrise.invoke<VaultCandidate[]>('vault:detect-candidates'),
  defaultNewPath: () =>
    window.nordrise.invoke<string>('vault:default-new-path'),
  create: (path?: string) =>
    window.nordrise.invoke<{ path: string }>('vault:create', path),
  ensureSeanStructure: (vaultRoot: string) =>
    window.nordrise.invoke<{ touched: string[]; seededSkills: string[] }>(
      'vault:ensure-sean-structure',
      vaultRoot,
    ),
  readSean: (vaultRoot: string, relpath: string) =>
    window.nordrise.invoke<string | null>('vault:read-sean', { vaultRoot, relpath }),
  writeSean: (vaultRoot: string, relpath: string, content: string) =>
    window.nordrise.invoke<{ ok: true }>('vault:write-sean', {
      vaultRoot,
      relpath,
      content,
    }),
  pickFolder: () =>
    window.nordrise.invoke<string | null>('vault:pick-folder-for-vault'),
};

// ---------- Skills ----------

export interface SkillSummary {
  name: string;
  description: string;
  when_to_use?: string;
  required_tools: string[];
  files: string[];
  body: string;
}

export const phase3Skills = {
  listInstalled: (vaultRoot: string) =>
    window.nordrise.invoke<SkillSummary[]>('skills:list-installed', vaultRoot),
  listRegistry: (vaultRoot: string) =>
    window.nordrise.invoke<SkillSummary[]>('skills:list-registry', vaultRoot),
  install: (vaultRoot: string, skillName: string) =>
    window.nordrise.invoke<
      | { ok: true; installedTo: string }
      | { ok: false; error: string }
    >('skills:install', { vaultRoot, skillName }),
  load: (vaultRoot: string, skillName: string) =>
    window.nordrise.invoke<SkillSummary | null>('skills:load', {
      vaultRoot,
      skillName,
    }),
  parse: (raw: string) => window.nordrise.invoke<SkillSummary>('skills:parse', raw),
};

// ---------- Heartbeat ----------

export interface HeartbeatStatus {
  state: 'idle' | 'running' | 'paused';
  lastTickAt: number | null;
  nextTickAt: number | null;
  lastError: string | null;
}

export const phase3Heartbeat = {
  status: () => window.nordrise.invoke<HeartbeatStatus>('heartbeat:status'),
  pause: () => window.nordrise.invoke<HeartbeatStatus>('heartbeat:pause'),
  resume: () => window.nordrise.invoke<HeartbeatStatus>('heartbeat:resume'),
  tickNow: () => window.nordrise.invoke<HeartbeatStatus>('heartbeat:tick-now'),
  /**
   * Subscribe to status broadcasts. Returns an unsubscribe function.
   * Used by the StatusBar Health pill to flip green/yellow/red live.
   */
  subscribe: (listener: (s: HeartbeatStatus) => void): (() => void) => {
    const off = window.nordrise.on('heartbeat:status', (s: unknown) => {
      listener(s as HeartbeatStatus);
    });
    return off;
  },
};

// ---------- Checkpoint ----------

export interface Checkpoint {
  id: string;
  createdAt: number;
  summary: string;
  git: boolean;
  stashRef?: string;
  copyDir?: string;
}

export const phase3Checkpoint = {
  create: (workspace: string, summary: string) =>
    window.nordrise.invoke<Checkpoint>('checkpoint:create', { workspace, summary }),
  list: (workspace: string) =>
    window.nordrise.invoke<Checkpoint[]>('checkpoint:list', workspace),
  rollback: (workspace: string, id: string) =>
    window.nordrise.invoke<{ ok: true } | { ok: false; error: string }>(
      'checkpoint:rollback',
      { workspace, id },
    ),
};

// ---------- Errors / health ----------

export const phase3Errors = {
  log: (entry: {
    level: 'error' | 'warn';
    message: string;
    stack?: string;
    context?: Record<string, unknown>;
  }) =>
    window.nordrise.invoke<{ ok: true; path: string }>('errors:log', entry),
  tail: (n = 20) => window.nordrise.invoke<string[]>('errors:tail', n),
};

// ---------- Lighthouse ----------

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}
export interface LighthouseAudit {
  url: string;
  scores: LighthouseScores;
  topIssues: Array<{
    id: string;
    title: string;
    description: string;
    impact: string;
  }>;
  jsonPath?: string;
  startedAt: number;
  finishedAt: number;
}

export const phase3Lighthouse = {
  run: (p: { url: string; formFactor?: 'mobile' | 'desktop'; vaultRoot?: string }) =>
    window.nordrise.invoke<LighthouseAudit>('lighthouse:run', p),
};

// ---------- Preview ----------

export const phase3Preview = {
  isLikely: (port: number) =>
    window.nordrise.invoke<boolean>('preview:is-likely', port),
  scan: (opts?: { timeoutMs?: number }) =>
    window.nordrise.invoke<number[]>('preview:scan', opts ?? {}),
  sniff: (url: string) => window.nordrise.invoke<string>('preview:sniff', url),
};
