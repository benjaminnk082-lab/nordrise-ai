/**
 * skillsLoader — Anthropic-style SKILL.md parser + registry helpers.
 *
 * Pure-Node module (no child_process, no Electron, no network). Parses
 * SKILL.md frontmatter (a tiny YAML subset) and copies skills between
 * the registry and the installed locations under `<vault>/Sean/skills/`.
 *
 * Per CLAUDE.md §14, every install is gated on user confirmation in the
 * IPC layer — this module just does the file work.
 */
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import { atomicWrite } from './vaultPaths.js';

export interface ParsedSkill {
  name: string;
  description: string;
  when_to_use?: string;
  required_tools: string[];
  files: string[];
  body: string;
  /** Raw frontmatter for forward-compat. */
  frontmatterRaw: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function parseSkill(raw: string): ParsedSkill {
  const m = FRONTMATTER_RE.exec(raw.trim());
  if (!m) {
    throw new Error('SKILL.md missing frontmatter delimiters (--- ... ---)');
  }
  const fmRaw = m[1] ?? '';
  const body = (m[2] ?? '').trim() + '\n';
  const fields = parseTinyYaml(fmRaw);

  const name = stringField(fields, 'name');
  const description = stringField(fields, 'description');
  if (!name) throw new Error('SKILL.md missing required field: name');
  if (!description) throw new Error('SKILL.md missing required field: description');

  return {
    name,
    description,
    when_to_use: stringField(fields, 'when_to_use') || undefined,
    required_tools: arrayField(fields, 'required_tools'),
    files: arrayField(fields, 'files'),
    body,
    frontmatterRaw: fmRaw,
  };
}

export async function listInstalledSkills(vaultRoot: string): Promise<ParsedSkill[]> {
  return listSkillsIn(join(vaultRoot, 'Sean', 'skills'));
}

export async function listRegistrySkills(vaultRoot: string): Promise<ParsedSkill[]> {
  return listSkillsIn(join(vaultRoot, 'Sean', 'skills-registry'));
}

async function listSkillsIn(root: string): Promise<ParsedSkill[]> {
  const out: ParsedSkill[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const skillPath = join(root, name, 'SKILL.md');
    try {
      const raw = await fs.readFile(skillPath, 'utf8');
      out.push(parseSkill(raw));
    } catch {
      // skip malformed / missing
    }
  }
  return out;
}

export async function installSkill(
  vaultRoot: string,
  skillName: string,
): Promise<{ ok: true; installedTo: string } | { ok: false; error: string }> {
  const src = join(vaultRoot, 'Sean', 'skills-registry', skillName);
  const dst = join(vaultRoot, 'Sean', 'skills', skillName);
  try {
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) return { ok: false, error: 'source is not a directory' };
  } catch {
    return { ok: false, error: 'source skill not found in registry' };
  }
  await fs.mkdir(dst, { recursive: true });
  const files = await fs.readdir(src);
  for (const f of files) {
    const data = await fs.readFile(join(src, f), 'utf8');
    await atomicWrite(join(dst, f), data);
  }
  return { ok: true, installedTo: dst };
}

export function buildSkillContextFragment(skill: ParsedSkill): string {
  const filesNote =
    skill.files.length > 0
      ? `\n\n**Supporting files (read with the file tool when relevant):**\n${skill.files.map((f) => `- ${f}`).join('\n')}`
      : '';
  return [
    `## Skill loaded: ${skill.name}`,
    skill.description ? `> ${skill.description}` : '',
    '',
    skill.body.trim(),
    filesNote,
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- tiny YAML — just the subset SKILL.md needs ----------

type YamlValue = string | string[];

function parseTinyYaml(raw: string): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1] as string;
    const rest = (m[2] as string).trim();
    if (rest === '') {
      const items: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? '';
        const im = /^\s+-\s+(.*)$/.exec(next);
        if (!im) break;
        items.push(unquote(im[1] as string));
        i += 1;
      }
      out[key] = items;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      out[key] = inner === '' ? [] : inner.split(',').map((s) => unquote(s.trim()));
      i += 1;
      continue;
    }
    out[key] = unquote(rest);
    i += 1;
  }
  return out;
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function stringField(f: Record<string, YamlValue>, key: string): string {
  const v = f[key];
  return typeof v === 'string' ? v : '';
}

function arrayField(f: Record<string, YamlValue>, key: string): string[] {
  const v = f[key];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
  return [];
}

export async function loadSkillBody(
  vaultRoot: string,
  skillName: string,
): Promise<ParsedSkill | null> {
  const skillFile = join(vaultRoot, 'Sean', 'skills', skillName, 'SKILL.md');
  try {
    const raw = await fs.readFile(skillFile, 'utf8');
    return parseSkill(raw);
  } catch {
    return null;
  }
}

export function skillSourcePath(vaultRoot: string, skillName: string): string {
  return join(vaultRoot, 'Sean', 'skills', basename(skillName));
}
