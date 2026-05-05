/**
 * vaultPaths — Obsidian vault auto-detect + atomic-write primitives.
 *
 * Pure-Node module (no Electron deps). The IPC layer in `main/ipc.ts`
 * wraps these and surfaces them as `vault:*` channels (see CLAUDE.md §12).
 *
 * Atomic write contract (DO NOT BREAK §13): every renderer-driven write
 * into the vault MUST go through `atomicWrite` so Obsidian's file watcher
 * never observes a half-finished file.
 */
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface VaultCandidate {
  path: string;
  /** True if `<path>/.obsidian/` exists. */
  hasObsidianFolder: boolean;
  /** True if `<path>/Sean/` already has our scaffolding. */
  hasSeanFolder: boolean;
}

const KNOWN_PARENT_DIRS = (): string[] => [
  join(homedir(), 'Documents'),
  join(homedir(), 'Obsidian'),
  join(homedir(), 'OneDrive', 'Documents'),
  join(homedir(), 'OneDrive', 'Dokumenter'), // nb-locale
];

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scan the well-known parent dirs for folders containing a `.obsidian/`
 * subfolder. Returns candidates in path order (most-likely first).
 *
 * Returns `[]` on a fresh machine or when none of the well-known
 * parents exist; never throws.
 */
export async function detectVaultCandidates(): Promise<VaultCandidate[]> {
  const out: VaultCandidate[] = [];
  for (const parent of KNOWN_PARENT_DIRS()) {
    if (!(await dirExists(parent))) continue;
    let entries: string[];
    try {
      entries = await fs.readdir(parent);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const path = join(parent, name);
      const hasObsidianFolder = await dirExists(join(path, '.obsidian'));
      if (!hasObsidianFolder) continue;
      out.push({
        path,
        hasObsidianFolder,
        hasSeanFolder: await dirExists(join(path, 'Sean')),
      });
    }
  }
  return out;
}

/**
 * Atomic write — write to `<path>.tmp` first, then `fs.rename`. Obsidian
 * sees a single rename event and the file is never observed mid-write.
 * Creates parent dirs as needed.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, path);
}

/**
 * Read a file under `<vault>/Sean/<relpath>`. Returns `null` if missing
 * (vs throwing) so callers can fall through to a sensible default.
 */
export async function readSeanFile(
  vaultRoot: string,
  relpath: string,
): Promise<string | null> {
  const p = join(vaultRoot, 'Sean', relpath);
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Atomic write under `<vault>/Sean/<relpath>`. Sibling of `atomicWrite`.
 */
export async function writeSeanFile(
  vaultRoot: string,
  relpath: string,
  content: string,
): Promise<void> {
  await atomicWrite(join(vaultRoot, 'Sean', relpath), content);
}

/**
 * Idempotent scaffolding — creates the `Sean/` directory tree and seeds
 * `HEARTBEAT.md` + `memories.md` if they don't exist. Returns the list of
 * paths it touched.
 */
export async function ensureSeanStructure(vaultRoot: string): Promise<string[]> {
  const touched: string[] = [];
  const dirs = ['Sean', 'Sean/sessions', 'Sean/projects', 'Sean/skills', 'Sean/skills-registry', 'Sean/audits'];
  for (const d of dirs) {
    const full = join(vaultRoot, d);
    if (!existsSync(full)) {
      await fs.mkdir(full, { recursive: true });
      touched.push(full);
    }
  }
  const seedFiles: Array<[string, string]> = [
    [
      'Sean/HEARTBEAT.md',
      [
        '# Heartbeat',
        '',
        'Sean leser denne filen hver 30. minutt når den er ledig. Skriv',
        'opp ting du vil at Sean skal sjekke / minne deg om / fullføre.',
        'Tomme (eller alle krysset av) → Sean svarer `HEARTBEAT_OK` og',
        'sender ingen varsling. Annet svar dukker opp som Windows-toast.',
        '',
        '- [ ] (eksempel) Sjekk om vault-sync har stoppet',
        '',
      ].join('\n'),
    ],
    [
      'Sean/memories.md',
      [
        '# Memories',
        '',
        'Append-only logg. Sean skriver hit når den lærer noe nytt om',
        'Benjamin, prosjektene eller arbeidsmønstrene som er verdt å huske',
        'på tvers av økter.',
        '',
      ].join('\n'),
    ],
    [
      'Sean/errors.md',
      [
        '# Errors',
        '',
        'Local Sentry-style log. Hver linje er en JSON-record skrevet av',
        '`appendErrorLog()` i `apps/control/main/lib/robustness.ts`.',
        'Bruk `tail` eller åpne i Obsidian for å lese.',
        '',
      ].join('\n'),
    ],
  ];
  for (const [rel, body] of seedFiles) {
    const full = join(vaultRoot, rel);
    if (!existsSync(full)) {
      await atomicWrite(full, body);
      touched.push(full);
    }
  }
  return touched;
}

/**
 * Create a brand-new vault when the user has none. Initialises a minimal
 * `.obsidian/app.json` so Obsidian recognises it on first open, and
 * scaffolds the Sean tree.
 */
export async function createVault(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
  await fs.mkdir(join(path, '.obsidian'), { recursive: true });
  // Smallest viable Obsidian config — enables markdown editor only.
  const appJson = JSON.stringify({ vimMode: false }, null, 2);
  await atomicWrite(join(path, '.obsidian', 'app.json'), appJson);
  await ensureSeanStructure(path);
}

/**
 * Suggested default path for a fresh vault when no candidates were found.
 */
export function defaultNewVaultPath(): string {
  return join(homedir(), 'Documents', 'Nordrise Vault');
}
