'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuickTask } from '../lib/quickTasks';
import { qt, substituteTemplate } from '../lib/quickTasks';
import { VariablePrompt } from './VariablePrompt';

export interface QuickTaskPaletteProps {
  open: boolean;
  onClose: () => void;
  onPick: (text: string) => void;
  onOpenManage: () => void;
}

export function QuickTaskPalette({
  open,
  onClose,
  onPick,
  onOpenManage,
}: QuickTaskPaletteProps) {
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => {
      return (
        t.title.toLowerCase().includes(q) ||
        t.emoji.toLowerCase().includes(q) ||
        t.template.toLowerCase().includes(q)
      );
    });
  }, [tasks, query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  function pick(task: QuickTask) {
    if (task.variables && task.variables.length > 0) {
      setVarTask(task);
      return;
    }
    // No variables — substitute (no-op if none) and fire.
    const text = substituteTemplate(task.template, {});
    onPick(text);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (varTask) setVarTask(null);
      else onClose();
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
      const t = filtered[highlight];
      if (t) pick(t);
    }
  }

  if (!open) return null;

  return (
    <div className="qt-modal-backdrop" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="qt-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          placeholder="Søk quick-tasks…"
          className="qt-palette-search"
          autoFocus
        />
        <div className="qt-palette-list">
          {filtered.length === 0 && (
            <div className="qt-palette-empty">
              {tasks.length === 0
                ? 'Ingen quick-tasks ennå. Lag en under.'
                : 'Ingen treff.'}
            </div>
          )}
          {filtered.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className={
                i === highlight ? 'qt-palette-row qt-palette-row-active' : 'qt-palette-row'
              }
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pick(t)}
            >
              <span className="qt-palette-emoji">{t.emoji || '⚡'}</span>
              <span className="qt-palette-title">{t.title}</span>
              {t.variables.length > 0 && (
                <span className="qt-palette-badge">
                  {t.variables.length} var
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="qt-palette-foot">
          <button
            type="button"
            className="qt-palette-newlink"
            onClick={() => {
              onClose();
              onOpenManage();
            }}
          >
            + Ny quick-task
          </button>
          <span className="qt-palette-hint">↑↓ naviger · Enter velg · Esc lukk</span>
        </div>
      </div>
      {varTask && (
        <VariablePrompt
          task={varTask}
          onConfirm={(finalText) => {
            setVarTask(null);
            onPick(finalText);
            onClose();
          }}
          onCancel={() => setVarTask(null)}
        />
      )}
    </div>
  );
}
