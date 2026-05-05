/**
 * phase3Ipc — registers all Phase 3 IPC handlers.
 *
 * Called from `registerIpc()` in `ipc.ts`. Keeps the new channels
 * (vault:*, skills:*, heartbeat:*, checkpoint:*, errors:*, costs:*,
 * lighthouse:*, preview:*) physically isolated so the existing IPC
 * surface (the §4 inventory in CLAUDE.md) is easy to diff.
 *
 * All handlers are wrapped with `withErrorLogging` so any thrown error
 * lands in `<vault>/Sean/errors.md` AND propagates back to the renderer
 * — see CLAUDE.md §12 + DO NOT BREAK §13.
 */
import { ipcMain, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  detectVaultCandidates,
  createVault as createVaultFs,
  ensureSeanStructure,
  readSeanFile,
  writeSeanFile,
  defaultNewVaultPath,
} from './lib/vaultPaths.js';
import {
  installSkill,
  listInstalledSkills,
  listRegistrySkills,
  loadSkillBody,
  parseSkill,
} from './lib/skillsLoader.js';
import {
  createCheckpoint,
  listCheckpoints,
  rollbackCheckpoint,
} from './lib/checkpoint.js';
import { appendErrorLog, withErrorLogging } from './lib/robustness.js';
import { runLighthouse } from './lib/lighthouseRunner.js';
import {
  isLikelyDevServerPort,
  scanCommonDevPorts,
  sniffFramework,
} from './lib/previewPorts.js';
import {
  getHeartbeatStatus,
  initHeartbeat,
  pauseHeartbeat,
  startHeartbeat,
  tickNow,
} from './heartbeat.js';
import { getSettings } from './settingsStore.js';
import { askSean } from './seanCall.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the seed-skills shipped with the desktop app. */
const SEED_SKILLS_DIR = join(__dirname, '..', 'seed-skills');

function vaultRootFromSettings(): string | null {
  const s = getSettings();
  const p = s.vault?.localPath;
  return typeof p === 'string' && p.trim() !== '' ? p : null;
}

function errorsLogPath(): string {
  const v = vaultRootFromSettings();
  return v ? join(v, 'Sean', 'errors.md') : join(__dirname, 'errors.md.fallback');
}

function wrap<TArgs extends unknown[], TRet>(
  channel: string,
  fn: (...args: TArgs) => Promise<TRet>,
): (...args: TArgs) => Promise<TRet> {
  return withErrorLogging(errorsLogPath(), channel, fn);
}

/**
 * Copy the desktop's bundled seed-skills/* into
 * `<vault>/Sean/skills-registry/` IFF the registry is empty. Idempotent.
 */
async function seedSkillsRegistry(vaultRoot: string): Promise<string[]> {
  const dst = join(vaultRoot, 'Sean', 'skills-registry');
  await fs.mkdir(dst, { recursive: true });
  const existing = (await fs.readdir(dst).catch(() => [])).filter(
    (n) => !n.startsWith('.'),
  );
  if (existing.length > 0) return [];
  if (!existsSync(SEED_SKILLS_DIR)) return [];
  const skillDirs = await fs.readdir(SEED_SKILLS_DIR);
  const seeded: string[] = [];
  for (const skillName of skillDirs) {
    const srcDir = join(SEED_SKILLS_DIR, skillName);
    const stat = await fs.stat(srcDir);
    if (!stat.isDirectory()) continue;
    const dstDir = join(dst, skillName);
    await fs.mkdir(dstDir, { recursive: true });
    for (const f of await fs.readdir(srcDir)) {
      const data = await fs.readFile(join(srcDir, f), 'utf8');
      await fs.writeFile(join(dstDir, f), data, 'utf8');
    }
    seeded.push(skillName);
  }
  return seeded;
}

/** Best-effort main window lookup — skips popups. Used by the
 * heartbeat daemon to read focus state. */
function findMainWindow(): BrowserWindow | null {
  const all = BrowserWindow.getAllWindows();
  const main = all.find((w) => !w.webContents.getURL().includes('/popup/'));
  return main ?? all[0] ?? null;
}

export function registerPhase3Ipc(): void {
  const getMainWindow = findMainWindow;
  // ─────────────────────────────────────────────────────────────────
  // Vault
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'vault:detect-candidates',
    wrap('vault:detect-candidates', async () => detectVaultCandidates()),
  );
  ipcMain.handle(
    'vault:create',
    wrap('vault:create', async (_e, path?: string) => {
      const target = path && path.trim() !== '' ? path : defaultNewVaultPath();
      await createVaultFs(target);
      await seedSkillsRegistry(target);
      return { path: target };
    }),
  );
  ipcMain.handle(
    'vault:default-new-path',
    wrap('vault:default-new-path', async () => defaultNewVaultPath()),
  );
  ipcMain.handle(
    'vault:ensure-sean-structure',
    wrap('vault:ensure-sean-structure', async (_e, vaultRoot: string) => {
      const touched = await ensureSeanStructure(vaultRoot);
      const seeded = await seedSkillsRegistry(vaultRoot);
      return { touched, seededSkills: seeded };
    }),
  );
  ipcMain.handle(
    'vault:read-sean',
    wrap('vault:read-sean', async (_e, payload: { vaultRoot: string; relpath: string }) => {
      return readSeanFile(payload.vaultRoot, payload.relpath);
    }),
  );
  ipcMain.handle(
    'vault:write-sean',
    wrap('vault:write-sean', async (
      _e,
      payload: { vaultRoot: string; relpath: string; content: string },
    ) => {
      await writeSeanFile(payload.vaultRoot, payload.relpath, payload.content);
      return { ok: true };
    }),
  );
  ipcMain.handle(
    'vault:pick-folder-for-vault',
    wrap('vault:pick-folder-for-vault', async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled) return null;
      return r.filePaths[0] ?? null;
    }),
  );

  // ─────────────────────────────────────────────────────────────────
  // Skills
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'skills:list-installed',
    wrap('skills:list-installed', async (_e, vaultRoot: string) =>
      listInstalledSkills(vaultRoot),
    ),
  );
  ipcMain.handle(
    'skills:list-registry',
    wrap('skills:list-registry', async (_e, vaultRoot: string) =>
      listRegistrySkills(vaultRoot),
    ),
  );
  ipcMain.handle(
    'skills:install',
    wrap('skills:install', async (_e, p: { vaultRoot: string; skillName: string }) =>
      installSkill(p.vaultRoot, p.skillName),
    ),
  );
  ipcMain.handle(
    'skills:load',
    wrap('skills:load', async (_e, p: { vaultRoot: string; skillName: string }) =>
      loadSkillBody(p.vaultRoot, p.skillName),
    ),
  );
  ipcMain.handle(
    'skills:parse',
    wrap('skills:parse', async (_e, raw: string) => parseSkill(raw)),
  );

  // ─────────────────────────────────────────────────────────────────
  // Heartbeat
  // ─────────────────────────────────────────────────────────────────
  initHeartbeat({
    getVaultPath: () => vaultRootFromSettings(),
    getMainWindow,
    askSean: async (prompt: string) => {
      // Heartbeat uses Haiku to keep the cost-tail tiny — these calls
      // happen up to ~50 times a day on the default 30-min interval.
      const r = await askSean(prompt, {
        controlSessionId: null,
        model: 'claude-haiku-4-5',
        timeoutMs: 60_000,
      });
      if (r.isError) {
        // Surface to errors.md AND let the daemon's tick handler swallow
        // — the user shouldn't see toasts for transient gateway hiccups.
        throw new Error(`heartbeat askSean: ${r.errorMessage ?? 'unknown'}`);
      }
      return r.text;
    },
    getActiveProjectName: () => null,
  });
  ipcMain.handle(
    'heartbeat:status',
    wrap('heartbeat:status', async () => getHeartbeatStatus()),
  );
  ipcMain.handle(
    'heartbeat:pause',
    wrap('heartbeat:pause', async () => pauseHeartbeat()),
  );
  ipcMain.handle(
    'heartbeat:resume',
    wrap('heartbeat:resume', async () => startHeartbeat()),
  );
  ipcMain.handle(
    'heartbeat:tick-now',
    wrap('heartbeat:tick-now', async () => tickNow()),
  );

  // ─────────────────────────────────────────────────────────────────
  // Checkpoint
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'checkpoint:create',
    wrap('checkpoint:create', async (_e, p: { workspace: string; summary: string }) =>
      createCheckpoint(p.workspace, p.summary),
    ),
  );
  ipcMain.handle(
    'checkpoint:list',
    wrap('checkpoint:list', async (_e, workspace: string) =>
      listCheckpoints(workspace),
    ),
  );
  ipcMain.handle(
    'checkpoint:rollback',
    wrap('checkpoint:rollback', async (_e, p: { workspace: string; id: string }) =>
      rollbackCheckpoint(p.workspace, p.id),
    ),
  );

  // ─────────────────────────────────────────────────────────────────
  // Errors / health
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'errors:log',
    wrap('errors:log', async (
      _e,
      p: {
        level: 'error' | 'warn';
        message: string;
        stack?: string;
        context?: Record<string, unknown>;
      },
    ) => {
      const path = errorsLogPath();
      await appendErrorLog(path, p);
      return { ok: true, path };
    }),
  );
  ipcMain.handle(
    'errors:tail',
    wrap('errors:tail', async (_e, n: number) => {
      const path = errorsLogPath();
      try {
        const txt = await fs.readFile(path, 'utf8');
        // Each entry is delimited by `## ` at the start of a line; tail N.
        const blocks = txt.split(/^## /m).filter((s) => s.trim() !== '');
        return blocks.slice(-Math.max(1, n)).map((s) => '## ' + s);
      } catch {
        return [];
      }
    }),
  );

  // ─────────────────────────────────────────────────────────────────
  // Lighthouse — defers to lib runner; the lib falls back to a stub
  // when `lighthouse` + `chrome-launcher` aren't installed.
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'lighthouse:run',
    wrap(
      'lighthouse:run',
      async (
        _e,
        p: { url: string; formFactor?: 'mobile' | 'desktop'; vaultRoot?: string },
      ) => {
        let jsonPath: string | undefined;
        if (p.vaultRoot) {
          const stamp = new Date().toISOString().slice(0, 10);
          let host = p.url;
          try {
            host = new URL(p.url).hostname;
          } catch {
            host = p.url.replace(/[^a-z0-9.-]/gi, '_');
          }
          jsonPath = join(p.vaultRoot, 'Sean', 'audits', `${stamp}-${host}.json`);
        }
        return runLighthouse(p.url, {
          formFactor: p.formFactor,
          jsonPath,
        });
      },
    ),
  );

  // ─────────────────────────────────────────────────────────────────
  // Preview — port detection helpers; the BrowserView mount lives
  // separately when wired (Phase 3.5). Renderer can already call
  // `preview:scan` to populate its picker.
  // ─────────────────────────────────────────────────────────────────
  ipcMain.handle(
    'preview:is-likely',
    wrap('preview:is-likely', async (_e, port: number) => isLikelyDevServerPort(port)),
  );
  ipcMain.handle(
    'preview:scan',
    wrap('preview:scan', async (_e, opts: { timeoutMs?: number } = {}) =>
      scanCommonDevPorts(opts),
    ),
  );
  ipcMain.handle(
    'preview:sniff',
    wrap('preview:sniff', async (_e, url: string) => sniffFramework(url)),
  );
}
