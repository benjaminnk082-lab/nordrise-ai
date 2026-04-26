/**
 * vaultRoute.ts — Obsidian-vault sync (PC -> Sean) + Sean's notes.
 *
 * - GET    /vault/manifest      — list of stored vault files with sha256 + size
 * - POST   /vault/files         — upload/overwrite a single file (multipart)
 * - DELETE /vault/files?path=…  — delete a single file (idempotent)
 * - GET    /vault/sean-notes    — list pending Sean-written note proposals
 * - DELETE /vault/sean-notes?path=…  — dismiss one (after the desktop app
 *                                  copies it into the user's local vault)
 *
 * Path-traversal guard is tight: rejects "..", absolute paths, drive-letters,
 * empty segments, and anything that resolves outside the bound directory.
 *
 * Files are stored as plain bytes under deps.vaultDir / deps.seanNotesDir.
 * Sean reads the vault as filesystem inside `/app/workspace/vault/`.
 */

import { Router } from 'express';
import multer from 'multer';
import {
  writeFile,
  readFile,
  unlink,
  mkdir,
  readdir,
  stat,
  rm,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, normalize, relative, isAbsolute } from 'node:path';
import { logger } from '../../logger.js';
import { makeRequireControlToken } from './auth.js';

export interface VaultRouterDeps {
  /** absolute path to the synced vault folder, e.g. /app/workspace/vault */
  vaultDir: string;
  /** absolute path to where Sean writes new note proposals */
  seanNotesDir: string;
  allowedTokens: readonly string[];
  /** per-file size cap in bytes */
  maxFileBytes: number;
}

interface FileEntry {
  path: string;
  size: number;
  mtime: number;
  sha256: string;
}

/** True iff `child` is strictly inside `parent` (after normalization). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Sanitize a relative path coming from a client.
 * Returns null on anything that smells like traversal or filesystem nonsense.
 *
 * Rules:
 *  - non-empty
 *  - no ".." segment
 *  - no "." segment (would normalize to identity but the rule lets us reject
 *    clients sending nonsense paths)
 *  - not absolute (unix or win)
 *  - no drive-letter prefix (e.g. "C:")
 *  - no empty segments after splitting on / or \
 *  - each segment <= 200 chars
 *  - returns posix-style joined path with `/` separators
 */
export function sanitizeRelPath(p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  // explicit absolute / drive-letter rejection — relative() can't fully save us
  // on Windows where "C:foo" is a drive-relative path.
  if (/^([a-zA-Z]:|\/|\\)/.test(p)) return null;
  if (p.includes('\0')) return null;
  const parts = p.split(/[\\/]+/).filter((x) => x.length > 0);
  if (parts.length === 0) return null;
  for (const seg of parts) {
    if (seg === '.' || seg === '..') return null;
    if (seg.length > 200) return null;
    if (seg.includes('\0')) return null;
  }
  return parts.join('/');
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function walk(dir: string, base: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip dot-files (e.g. .obsidian)
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (e.isFile()) {
      try {
        const buf = await readFile(full);
        const st = await stat(full);
        out.push({
          path: relative(base, full).replace(/\\/g, '/'),
          size: st.size,
          mtime: st.mtimeMs,
          sha256: sha256(buf),
        });
      } catch {
        // skip unreadable files — race with the watcher / live deletes is fine
      }
    }
  }
  return out;
}

export function makeVaultRouter(deps: VaultRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxFileBytes, files: 1 },
  });

  // Manifest: lists everything currently stored, so the client can compute a
  // diff against its local fs and only push changes / deletes.
  r.get('/vault/manifest', auth, async (_req, res) => {
    const files = await walk(deps.vaultDir, deps.vaultDir);
    res.json({ files });
  });

  // Upload (or overwrite) a single file at relative path.
  // Multipart: field 'file' = bytes, field 'path' = relative path.
  r.post('/vault/files', auth, upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'no_file' });
      return;
    }
    const rel = sanitizeRelPath(String(req.body?.path ?? ''));
    if (!rel) {
      res.status(400).json({ error: 'bad_path' });
      return;
    }
    const target = normalize(join(deps.vaultDir, rel));
    if (!isInside(deps.vaultDir, target)) {
      res.status(400).json({ error: 'path_traversal' });
      return;
    }
    try {
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, req.file.buffer);
    } catch (err) {
      logger.error({ err, rel }, 'vault file write failed');
      res.status(500).json({ error: 'write_failed' });
      return;
    }
    logger.info({ rel, size: req.file.size }, 'vault file written');
    res.json({ ok: true, path: rel });
  });

  r.delete('/vault/files', auth, async (req, res) => {
    const rel = sanitizeRelPath(String(req.query?.path ?? ''));
    if (!rel) {
      res.status(400).json({ error: 'bad_path' });
      return;
    }
    const target = normalize(join(deps.vaultDir, rel));
    if (!isInside(deps.vaultDir, target)) {
      res.status(400).json({ error: 'path_traversal' });
      return;
    }
    try {
      await unlink(target);
    } catch {
      // idempotent — already gone is success
    }
    res.json({ ok: true });
  });

  // Pending Sean-notes — files Sean wrote to the sean-notes/ folder.
  // The desktop app polls this and surfaces them as cards.
  r.get('/vault/sean-notes', auth, async (_req, res) => {
    const files = await walk(deps.seanNotesDir, deps.seanNotesDir);
    const items = await Promise.all(
      files.map(async (f) => {
        const content = await readFile(
          join(deps.seanNotesDir, f.path),
          'utf8',
        ).catch(() => '');
        return { path: f.path, size: f.size, mtime: f.mtime, content };
      }),
    );
    res.json({ notes: items });
  });

  r.delete('/vault/sean-notes', auth, async (req, res) => {
    const rel = sanitizeRelPath(String(req.query?.path ?? ''));
    if (!rel) {
      res.status(400).json({ error: 'bad_path' });
      return;
    }
    const target = normalize(join(deps.seanNotesDir, rel));
    if (!isInside(deps.seanNotesDir, target)) {
      res.status(400).json({ error: 'path_traversal' });
      return;
    }
    try {
      await rm(target);
    } catch {
      // idempotent
    }
    res.json({ ok: true });
  });

  // multer's payload-too-large is reported via err.code === 'LIMIT_FILE_SIZE'.
  // Scope the handler to this sub-router so it doesn't shadow other routes.
  r.use(
    (
      err: { code?: string } | undefined,
      _req: unknown,
      // express signature
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res: any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: any,
    ) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'file_too_large' });
        return;
      }
      next(err);
    },
  );

  return r;
}
