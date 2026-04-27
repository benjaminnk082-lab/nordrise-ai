/**
 * retrieval.ts — Active retrieval of vault content for the per-message context.
 *
 * Before invoking the main bridge for a user message, we run a tiny Haiku-call
 * to extract 3-6 keywords/phrases from the message, walk the vault directory,
 * score each `.md` file by how many keywords appear in its filename + first
 * 500 chars, and prepend the top 3 matches (capped at 2000 chars each) into
 * the per-request `extraSystemPrompt`. The vault listing is cached for 5 min
 * to keep the cost of a per-message keyword extraction near-zero — the cache
 * is invalidated by the vault write/delete handlers.
 *
 * Fail-soft: any error in this path returns an empty string so the caller
 * proceeds without retrieval rather than crashing.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { z } from 'zod';
import type { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

interface VaultFile {
  /** path relative to vault root, posix-style */
  path: string;
  /** filename without `.md` */
  title: string;
  /** first 500 chars of file content */
  preview: string;
  /** content trimmed to 2000 chars (used when picked into context) */
  full: string;
}

let vaultCache: VaultFile[] | null = null;
let vaultCacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadVault(vaultDir: string): Promise<VaultFile[]> {
  const now = Date.now();
  if (vaultCache && now - vaultCacheLoadedAt < CACHE_TTL_MS) return vaultCache;

  const out: VaultFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip dot-files / dot-dirs (e.g. `.obsidian/`).
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        try {
          const content = await readFile(full, 'utf8');
          const rel = relative(vaultDir, full).replace(/\\/g, '/');
          out.push({
            path: rel,
            title: basename(e.name, '.md'),
            preview: content.slice(0, 500),
            full: content.slice(0, 2000),
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  await walk(vaultDir);
  vaultCache = out;
  vaultCacheLoadedAt = now;
  return out;
}

/**
 * Drop the cached vault listing. Called from vault write/delete handlers so
 * the next retrieval pass re-walks the directory tree.
 */
export function invalidateVaultCache(): void {
  vaultCache = null;
  vaultCacheLoadedAt = 0;
}

const KeywordsSchema = z.array(z.string().min(1).max(80)).max(8);

async function extractKeywords(
  message: string,
  bridge: Pick<ClaudeBridge, 'invoke'>,
): Promise<string[]> {
  // Skip retrieval for very short messages (e.g. "ok", "hei") — too noisy.
  if (message.trim().length < 25) return [];

  let result;
  try {
    result = await bridge.invoke({
      message: `Trekk ut 3-6 nøkkelord eller fraser fra denne brukermeldingen som kan brukes til å finne relevante notater i en Obsidian-vault. Bare returner JSON-array av strenger, ingen markdown.

Bruker-melding:
${message}

JSON-array:`,
      sessionId: null,
      model: 'claude-haiku-4-5',
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'retrieval: keyword extraction crashed',
    );
    return [];
  }
  if (result.isError) return [];
  const m = result.text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  const validated = KeywordsSchema.safeParse(parsed);
  return validated.success ? validated.data : [];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function score(file: VaultFile, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const titleLower = file.title.toLowerCase();
  const previewLower = file.preview.toLowerCase();
  const text = titleLower + ' ' + previewLower;
  let s = 0;
  for (const kw of keywords) {
    const lk = kw.toLowerCase();
    if (!lk) continue;
    if (titleLower.includes(lk)) s += 10;
    if (previewLower.includes(lk)) s += 3;
    // Bonus for exact word boundary match anywhere in title+preview.
    const re = new RegExp(`\\b${escapeRegex(lk)}\\b`, 'i');
    if (re.test(text)) s += 2;
  }
  return s;
}

export interface RetrieveOptions {
  vaultDir: string;
  message: string;
  bridge: Pick<ClaudeBridge, 'invoke'>;
}

/**
 * Build a "Retrieved context" block for the per-request system prompt. Returns
 * empty string when nothing should be injected (short message, no keywords,
 * vault empty, or no scored matches). Fail-soft: any thrown error returns ''.
 */
export async function retrieveContext(opts: RetrieveOptions): Promise<string> {
  const t0 = Date.now();
  try {
    const [files, keywords] = await Promise.all([
      loadVault(opts.vaultDir),
      extractKeywords(opts.message, opts.bridge),
    ]);
    if (keywords.length === 0 || files.length === 0) return '';
    const scored = files
      .map((f) => ({ file: f, score: score(f, keywords) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length === 0) return '';
    const sections = scored
      .map((x) => `### ${x.file.path}\n\n${x.file.full}`)
      .join('\n\n---\n\n');
    logger.info(
      { keywords, hits: scored.length, ms: Date.now() - t0 },
      'retrieval',
    );
    return `## Relevant kontekst fra Obsidian-vault\n\n_Du har lest disse filene fra vaulten din basert på brukerens melding. Bruk dette som bakgrunn._\n\n${sections}`;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'retrieval failed');
    return '';
  }
}

/** Test hook — only used in unit tests to inspect cache state. */
export function _peekCacheForTesting(): {
  size: number | null;
  loadedAt: number;
} {
  return {
    size: vaultCache?.length ?? null,
    loadedAt: vaultCacheLoadedAt,
  };
}
