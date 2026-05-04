'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import type { QuickTask } from '../lib/quickTasks';
import { qt, substituteTemplate } from '../lib/quickTasks';
import type { AppSettings } from '../lib/settings';
import { VariablePrompt } from './VariablePrompt';

/**
 * CommandPalette — universal Cmd/Ctrl+K palette.
 *
 * Combines four input streams into one ranked, fuzzy-matched list:
 *   1. Static commands (open settings, log out, new thread, …)
 *   2. Threads (jump-to)
 *   3. Quick-tasks (run-as-message; supports {{vars}})
 *   4. Connector toggles (instant on/off per connector)
 *
 * If the user types something with no matches and presses Enter, the input is
 * sent to Sean as a fresh message (the "ask Sean directly" escape hatch).
 */

type Row =
  | {
      kind: 'command';
      id: string;
      icon: string;
      title: string;
      sub?: string;
      hint?: string;
      run: () => void | Promise<void>;
    }
  | {
      kind: 'thread';
      id: string;
      icon: string;
      title: string;
      sub?: string;
      run: () => void;
    }
  | {
      kind: 'quicktask';
      id: string;
      icon: string;
      title: string;
      sub?: string;
      hint?: string;
      task: QuickTask;
    }
  | {
      kind: 'connector';
      id: string;
      icon: string;
      title: string;
      sub?: string;
      run: () => void | Promise<void>;
    }
  | {
      kind: 'ask';
      id: 'ask-sean';
      icon: string;
      title: string;
      sub?: string;
      run: () => void;
    };

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Send free text to Sean (fallback "ask" action). */
  onAsk: (text: string) => void;
  /** Pick a quick-task — same path as QuickTaskPalette. */
  onPick: (text: string) => void;
  /** Open the new-thread flow. */
  onNewThread: () => void;
  /** Jump to a specific thread by control session id. */
  onSelectThread: (sessionId: string) => void;
  onOpenSettings: (tab?: 'connectors' | 'general') => void;
  onOpenManageQuickTasks: () => void;
  onOpenSearch: () => void;
  onOpenPinned: () => void;
  onOpenSeanNotes?: () => void;
  onLogout: () => void | Promise<void>;
  sessions: ControlSessionSummary[];
  settings: AppSettings;
  /** Toggle a connector on/off — patches settings via parent. */
  onToggleConnector: (
    name: 'firecrawl' | 'github' | 'vercel' | 'teams' | 'itslearning' | 'visma',
    next: boolean,
  ) => void | Promise<void>;
}

const CONNECTOR_META: Record<
  'firecrawl' | 'github' | 'vercel' | 'teams' | 'itslearning' | 'visma',
  { icon: string; label: string }
> = {
  firecrawl: { icon: '🌐', label: 'Firecrawl' },
  github: { icon: '🐙', label: 'GitHub' },
  vercel: { icon: '🚀', label: 'Vercel' },
  teams: { icon: '👥', label: 'Microsoft Teams' },
  itslearning: { icon: '📚', label: 'Itslearning' },
  visma: { icon: '🏫', label: 'Visma InSchool' },
};

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 200;
  // Subsequence match: every char of q appears in t in order.
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return 50;
  }
  return 0;
}

export function CommandPalette({
  open,
  onClose,
  onAsk,
  onPick,
  onNewThread,
  onSelectThread,
  onOpenSettings,
  onOpenManageQuickTasks,
  onOpenSearch,
  onOpenPinned,
  onOpenSeanNotes,
  onLogout,
  sessions,
  settings,
  onToggleConnector,
}: CommandPaletteProps) {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [varTask, setVarTask] = useState<QuickTask | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    void qt.list().then(setTasks).catch(() => setTasks([]));
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setVarTask(null);
    onClose();
  };

  const baseCommands = useMemo<Row[]>(() => {
    const cmds: Row[] = [
      {
        kind: 'command',
        id: 'cmd-new-thread',
        icon: '＋',
        title: 'Ny samtale',
        sub: 'Start en ny tråd',
        hint: 'Ctrl+N',
        run: () => {
          onNewThread();
          close();
        },
      },
      {
        kind: 'command',
        id: 'cmd-settings',
        icon: '⚙️',
        title: 'Innstillinger',
        sub: 'Modeller, tema, vault, permissions',
        run: () => {
          onOpenSettings('general');
          close();
        },
      },
      {
        kind: 'command',
        id: 'cmd-connectors',
        icon: '🔌',
        title: 'Connectors',
        sub: 'Teams, Itslearning, Visma, GitHub …',
        run: () => {
          onOpenSettings('connectors');
          close();
        },
      },
      {
        kind: 'command',
        id: 'cmd-search',
        icon: '🔎',
        title: 'Søk i meldinger',
        sub: 'Globalt søk på tvers av tråder',
        hint: 'Ctrl+F',
        run: () => {
          onOpenSearch();
          close();
        },
      },
      {
        kind: 'command',
        id: 'cmd-pinned',
        icon: '⭐',
        title: 'Pinete meldinger',
        run: () => {
          onOpenPinned();
          close();
        },
      },
      {
        kind: 'command',
        id: 'cmd-quicktasks',
        icon: '⚡',
        title: 'Administrer quick-tasks',
        run: () => {
          onOpenManageQuickTasks();
          close();
        },
      },
    ];
    if (onOpenSeanNotes && settings.vault.enabled) {
      cmds.push({
        kind: 'command',
        id: 'cmd-sean-notes',
        icon: '📓',
        title: "Sean's notater",
        sub: 'Forslag fra Sean til vaulten',
        run: () => {
          onOpenSeanNotes();
          close();
        },
      });
    }
    cmds.push({
      kind: 'command',
      id: 'cmd-logout',
      icon: '↩',
      title: 'Logg ut',
      run: () => {
        void onLogout();
        close();
      },
    });
    return cmds;
  }, [
    onNewThread,
    onOpenSettings,
    onOpenSearch,
    onOpenPinned,
    onOpenManageQuickTasks,
    onOpenSeanNotes,
    onLogout,
    settings.vault.enabled,
  ]);

  const connectorRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (
      ['teams', 'itslearning', 'visma', 'github', 'firecrawl', 'vercel'] as const
    ).forEach((key) => {
      const c = settings.connectors?.[key];
      const enabled = !!c?.enabled;
      const meta = CONNECTOR_META[key];
      out.push({
        kind: 'connector',
        id: `conn-${key}`,
        icon: meta.icon,
        title: `${enabled ? 'Slå av' : 'Slå på'} ${meta.label}`,
        sub: enabled ? 'Aktivert' : 'Deaktivert',
        run: () => onToggleConnector(key, !enabled),
      });
    });
    return out;
  }, [settings.connectors, onToggleConnector]);

  const allRows = useMemo<Row[]>(() => {
    const threadRows: Row[] = sessions.slice(0, 50).map((s) => ({
      kind: 'thread',
      id: `thread-${s.id}`,
      icon: '💬',
      title: s.title?.trim() || 'Tråd uten tittel',
      sub: 'Tråd',
      run: () => {
        onSelectThread(s.id);
        close();
      },
    }));
    const taskRows: Row[] = tasks.map((t) => ({
      kind: 'quicktask',
      id: `qt-${t.id}`,
      icon: t.emoji || '⚡',
      title: t.title,
      sub: t.template.slice(0, 60),
      ...(t.variables.length > 0 ? { hint: `${t.variables.length} var` } : {}),
      task: t,
    }));
    return [...baseCommands, ...connectorRows, ...threadRows, ...taskRows];
  }, [baseCommands, connectorRows, sessions, tasks, onSelectThread]);

  const filtered = useMemo<Row[]>(() => {
    const q = query.trim();
    if (!q) return allRows.slice(0, 60);
    const scored = allRows
      .map((r) => {
        const haystack = `${r.title} ${r.sub ?? ''}`;
        return { r, score: fuzzyScore(haystack, q) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.r);
    if (scored.length === 0 && q.length >= 2) {
      // Escape hatch: send the typed text to Sean directly.
      const ask: Row = {
        kind: 'ask',
        id: 'ask-sean',
        icon: '↗',
        title: `Spør Sean: "${q}"`,
        sub: 'Send som ny melding',
        run: () => {
          onAsk(q);
          close();
        },
      };
      return [ask];
    }
    return scored;
  }, [allRows, query, onAsk]);

  useEffect(() => {
    if (highlight >= filtered.length) {
      setHighlight(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, highlight]);

  function pick(row: Row) {
    if (row.kind === 'quicktask') {
      if (row.task.variables.length > 0) {
        setVarTask(row.task);
        return;
      }
      const text = substituteTemplate(row.task.template, {});
      onPick(text);
      close();
      return;
    }
    void row.run();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (varTask) setVarTask(null);
      else close();
      return;
    }
    if (varTask) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = filtered[highlight];
      if (r) pick(r);
    }
  }

  if (!open) return null;

  return (
    <div className="qt-modal-backdrop" onClick={close} onKeyDown={handleKeyDown}>
      <div
        className="qt-palette cmd-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          placeholder="Skriv kommando, tråd eller spør Sean direkte…"
          className="qt-palette-search"
          autoFocus
        />
        <div className="qt-palette-list">
          {filtered.length === 0 && (
            <div className="qt-palette-empty">Ingen treff.</div>
          )}
          {filtered.map((r, i) => (
            <button
              key={r.id}
              type="button"
              className={
                i === highlight
                  ? 'qt-palette-row qt-palette-row-active'
                  : 'qt-palette-row'
              }
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(r)}
            >
              <span className="qt-palette-emoji">{r.icon}</span>
              <span className="qt-palette-title">
                {r.title}
                {r.sub && <span className="cmd-palette-sub">  {r.sub}</span>}
              </span>
              {'hint' in r && r.hint && (
                <span className="qt-palette-badge">{r.hint}</span>
              )}
            </button>
          ))}
        </div>
        <div className="qt-palette-foot">
          <span className="qt-palette-hint">
            ↑↓ naviger · Enter velg · Esc lukk
          </span>
        </div>
      </div>
      {varTask && (
        <VariablePrompt
          task={varTask}
          onConfirm={(finalText) => {
            setVarTask(null);
            onPick(finalText);
            close();
          }}
          onCancel={() => setVarTask(null)}
        />
      )}
    </div>
  );
}
