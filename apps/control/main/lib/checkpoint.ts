/**
 * checkpoint — git-stash-based code-mod safety net, with a copy fallback
 * for non-git workspaces.
 *
 * Pure-Node module. Uses `execFile` (not `exec`) with strictly arg-array
 * inputs — no shell, no string interpolation, no command injection
 * surface. Inputs (workspace path, summary text) come from the IPC
 * layer which validates them first.
 */
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface Checkpoint {
  id: string;
  createdAt: number;
  summary: string;
  /** True if backed by `git stash`; false if backed by a copy tree. */
  git: boolean;
  stashRef?: string;
  copyDir?: string;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function gitRun(cwd: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e.message ?? err),
    };
  }
}

export async function isGitRepo(workspace: string): Promise<boolean> {
  const r = await gitRun(workspace, ['rev-parse', '--is-inside-work-tree']);
  return r.exitCode === 0 && r.stdout.trim() === 'true';
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createCheckpoint(
  workspace: string,
  summary: string,
): Promise<Checkpoint> {
  const id = newId();
  const createdAt = Date.now();
  const isGit = await isGitRepo(workspace);

  if (isGit) {
    const message = `sean-checkpoint-${id}`;
    const r = await gitRun(workspace, ['stash', 'push', '-u', '-m', message]);
    const empty =
      /no local changes/i.test(r.stdout) || /no local changes/i.test(r.stderr);
    if (r.exitCode !== 0 && !empty) {
      throw new Error(
        `git stash failed (${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
    return {
      id,
      createdAt,
      summary,
      git: true,
      stashRef: empty ? undefined : await resolveStashRef(workspace, message),
    };
  }

  const dest = join('.sean-checkpoints', id);
  const destAbs = join(workspace, dest);
  await fs.mkdir(destAbs, { recursive: true });
  await copyTreeExcluding(workspace, destAbs, [
    '.sean-checkpoints',
    'node_modules',
    '.git',
  ]);
  return { id, createdAt, summary, git: false, copyDir: dest };
}

async function resolveStashRef(
  workspace: string,
  message: string,
): Promise<string | undefined> {
  const r = await gitRun(workspace, ['stash', 'list']);
  for (const line of r.stdout.split('\n')) {
    if (line.includes(message)) {
      const ref = line.split(':')[0]?.trim();
      if (ref) return ref;
    }
  }
  return undefined;
}

async function copyTreeExcluding(
  src: string,
  dst: string,
  exclude: string[],
): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (exclude.includes(e.name)) continue;
    const from = join(src, e.name);
    const to = join(dst, e.name);
    if (e.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyTreeExcluding(from, to, exclude);
    } else if (e.isFile()) {
      const data = await fs.readFile(from);
      await fs.writeFile(to, data);
    }
  }
}

export async function rollbackCheckpoint(
  workspace: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isGitRepo(workspace)) {
    const message = `sean-checkpoint-${id}`;
    const ref = await resolveStashRef(workspace, message);
    if (!ref) {
      return { ok: false, error: 'no matching stash for id (already dropped?)' };
    }
    const apply = await gitRun(workspace, ['stash', 'pop', ref]);
    if (apply.exitCode !== 0) {
      return {
        ok: false,
        error: `git stash pop failed: ${apply.stderr.trim() || apply.stdout.trim()}`,
      };
    }
    return { ok: true };
  }
  const dir = join(workspace, '.sean-checkpoints', id);
  if (!existsSync(dir)) {
    return { ok: false, error: 'checkpoint directory not found' };
  }
  await copyTreeExcluding(dir, workspace, []);
  await fs.rm(dir, { recursive: true, force: true });
  return { ok: true };
}

export async function listCheckpoints(workspace: string): Promise<Checkpoint[]> {
  if (await isGitRepo(workspace)) {
    const r = await gitRun(workspace, ['stash', 'list']);
    const out: Checkpoint[] = [];
    for (const line of r.stdout.split('\n')) {
      const m = /^(stash@\{\d+\}):.*sean-checkpoint-(\S+)/.exec(line);
      if (!m) continue;
      const [, ref, id] = m;
      out.push({
        id: id ?? '',
        createdAt: 0,
        summary: line,
        git: true,
        stashRef: ref ?? '',
      });
    }
    return out;
  }
  const dir = join(workspace, '.sean-checkpoints');
  if (!existsSync(dir)) return [];
  const ids = await fs.readdir(dir);
  const out: Checkpoint[] = [];
  for (const id of ids) {
    const stat = await fs.stat(join(dir, id));
    out.push({
      id,
      createdAt: stat.ctimeMs,
      summary: '(non-git checkpoint)',
      git: false,
      copyDir: join('.sean-checkpoints', id),
    });
  }
  return out;
}
