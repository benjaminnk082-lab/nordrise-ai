// Local renderer copy of quick-task types — main isn't a renderer dep, so we
// mirror the shape here. Keep in sync with apps/control/main/store.ts.

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

export const qt = {
  list: () => window.nordrise.invoke<QuickTask[]>('qt:list'),
  get: (id: string) => window.nordrise.invoke<QuickTask | null>('qt:get', id),
  create: (input: QuickTaskInput) =>
    window.nordrise.invoke<string>('qt:create', input),
  update: (id: string, patch: Partial<QuickTaskInput>) =>
    window.nordrise.invoke<void>('qt:update', { id, patch }),
  delete: (id: string) => window.nordrise.invoke<void>('qt:delete', id),
};

/**
 * Detect `{{name}}` placeholders in a template — used by the manage UI to
 * surface "Variabler:" hint while editing.
 */
export function detectVariables(template: string): QuickTaskVariable[] {
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

/**
 * Substitute `{{name}}` placeholders in a template using the given values.
 * Missing values become empty strings.
 */
export function substituteTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    return values[name] ?? '';
  });
}
