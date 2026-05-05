import { app } from 'electron';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createId } from '@paralleldrive/cuid2';

export interface QuickTaskVariable {
  name: string;
  prompt: string;
  default?: string;
}

export interface QuickTask {
  id: string;
  title: string;
  emoji: string;
  template: string;
  variables: QuickTaskVariable[];
  attachClipboard: boolean;
  hotkey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuickTaskInput {
  title: string;
  emoji?: string;
  template: string;
  variables?: QuickTaskVariable[];
  attachClipboard?: boolean;
  hotkey?: string | null;
}

interface QuickTaskRow {
  id: string;
  title: string;
  emoji: string;
  template: string;
  variables_json: string;
  attach_clipboard: number;
  hotkey: string | null;
  created_at: string;
  updated_at: string;
}

function detectVariables(template: string): QuickTaskVariable[] {
  const seen = new Set<string>();
  const out: QuickTaskVariable[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    const name = m[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    out.push({ name, prompt: `${cap}?` });
  }
  return out;
}

function rowToTask(row: QuickTaskRow): QuickTask {
  let variables: QuickTaskVariable[] = [];
  try {
    const parsed = JSON.parse(row.variables_json);
    if (Array.isArray(parsed)) variables = parsed as QuickTaskVariable[];
  } catch {
    variables = [];
  }
  // If stored variables are empty, auto-derive from template at read time.
  if (variables.length === 0) variables = detectVariables(row.template);
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    template: row.template,
    variables,
    attachClipboard: row.attach_clipboard === 1,
    hotkey: row.hotkey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class QuickTaskStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '',
        template TEXT NOT NULL,
        variables_json TEXT NOT NULL DEFAULT '[]',
        attach_clipboard INTEGER NOT NULL DEFAULT 0,
        hotkey TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  list(): QuickTask[] {
    const rows = this.db
      .prepare(`SELECT * FROM quick_tasks ORDER BY updated_at DESC`)
      .all() as QuickTaskRow[];
    return rows.map(rowToTask);
  }

  get(id: string): QuickTask | null {
    const row = this.db
      .prepare(`SELECT * FROM quick_tasks WHERE id = ?`)
      .get(id) as QuickTaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  create(input: QuickTaskInput): string {
    const id = createId();
    const now = new Date().toISOString();
    const variables = input.variables ?? detectVariables(input.template);
    this.db
      .prepare(
        `INSERT INTO quick_tasks (id, title, emoji, template, variables_json, attach_clipboard, hotkey, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.emoji ?? '',
        input.template,
        JSON.stringify(variables),
        input.attachClipboard ? 1 : 0,
        input.hotkey ?? null,
        now,
        now,
      );
    return id;
  }

  update(id: string, patch: Partial<QuickTaskInput>): void {
    const existing = this.get(id);
    if (!existing) return;
    const next: QuickTask = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
      ...(patch.template !== undefined ? { template: patch.template } : {}),
      ...(patch.attachClipboard !== undefined
        ? { attachClipboard: patch.attachClipboard }
        : {}),
      ...(patch.hotkey !== undefined ? { hotkey: patch.hotkey } : {}),
      ...(patch.variables !== undefined ? { variables: patch.variables } : {}),
    };
    // If template changed and variables weren't explicitly set in the patch,
    // re-detect from the new template.
    if (patch.template !== undefined && patch.variables === undefined) {
      next.variables = detectVariables(patch.template);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE quick_tasks
         SET title = ?, emoji = ?, template = ?, variables_json = ?, attach_clipboard = ?, hotkey = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.emoji,
        next.template,
        JSON.stringify(next.variables),
        next.attachClipboard ? 1 : 0,
        next.hotkey,
        now,
        id,
      );
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM quick_tasks WHERE id = ?`).run(id);
  }
}

let storeInstance: QuickTaskStore | null = null;

export function getStore(): QuickTaskStore {
  if (!storeInstance) {
    const dbPath = join(app.getPath('userData'), 'data.db');
    storeInstance = new QuickTaskStore(dbPath);
  }
  return storeInstance;
}
