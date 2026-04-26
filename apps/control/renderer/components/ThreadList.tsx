'use client';
import { useEffect, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';

export type ActiveSelection =
  | { kind: 'session'; id: string }
  | { kind: 'telegram' }
  | { kind: 'new' };

export interface ThreadListProps {
  sessions: ControlSessionSummary[];
  active: ActiveSelection;
  onSelect: (sel: ActiveSelection) => void;
  onNew: () => void;
  loading?: boolean;
  /** Triggered after a successful rename / archive so the parent can reload. */
  onAfterMutate?: () => void;
  /** Triggered when a session was archived; parent may want to deselect it. */
  onArchived?: (sessionId: string) => void;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'nå';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}t`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

async function ipcPatch<T>(path: string, body: unknown): Promise<T> {
  const r = await window.nordrise.invoke<{ ok: boolean; status: number; body: T }>(
    'control:fetch',
    { path, method: 'PATCH', body },
  );
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status}`);
  return r.body;
}

async function ipcPost<T>(path: string, body: unknown): Promise<T> {
  const r = await window.nordrise.invoke<{ ok: boolean; status: number; body: T }>(
    'control:fetch',
    { path, method: 'POST', body },
  );
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}`);
  return r.body;
}

export function ThreadList({
  sessions,
  active,
  onSelect,
  onNew,
  loading,
  onAfterMutate,
  onArchived,
}: ThreadListProps) {
  // Track which row is in inline-edit mode and the working title.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // Track which row's "more" menu is open.
  const [menuId, setMenuId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  // Click-outside the menu closes it.
  useEffect(() => {
    if (!menuId) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.thread-item-menu')) setMenuId(null);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuId]);

  async function commitRename(sid: string) {
    const value = editValue.trim();
    setEditingId(null);
    if (!value) return;
    try {
      await ipcPatch(`/control/sessions/${sid}`, { title: value });
      onAfterMutate?.();
    } catch (err) {
      console.warn('rename failed', err);
    }
  }

  async function archive(sid: string) {
    try {
      await ipcPost(`/control/sessions/${sid}/archive`, {});
      onArchived?.(sid);
      onAfterMutate?.();
    } catch (err) {
      console.warn('archive failed', err);
    }
  }

  return (
    <aside className="thread-rail">
      <div className="thread-rail-head">
        <span className="thread-rail-title">Tråder</span>
        <button type="button" className="thread-new-btn" onClick={onNew} title="Ny tråd">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
          Ny
        </button>
      </div>

      <div className="thread-list">
        {loading && sessions.length === 0 && (
          <>
            <div className="skeleton skeleton-thread" />
            <div className="skeleton skeleton-thread" style={{ opacity: 0.7 }} />
            <div className="skeleton skeleton-thread" style={{ opacity: 0.45 }} />
          </>
        )}
        {!loading && sessions.length === 0 && (
          <div className="thread-empty">
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              Ingen tråder ennå
            </div>
            <div style={{ fontSize: 11, color: 'rgba(244,244,247,0.4)' }}>
              Trykk <strong>+ Ny</strong> for å starte
            </div>
          </div>
        )}
        {sessions.map((s) => {
          const isActive = active.kind === 'session' && active.id === s.id;
          const isEditing = editingId === s.id;
          return (
            <div
              key={s.id}
              className={`thread-item ${isActive ? 'thread-item-active' : ''}`}
              onClick={() => {
                if (!isEditing) onSelect({ kind: 'session', id: s.id });
              }}
              role="button"
              tabIndex={isEditing ? -1 : 0}
              onKeyDown={(e) => {
                if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSelect({ kind: 'session', id: s.id });
                }
              }}
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className="thread-item-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') void commitRename(s.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => void commitRename(s.id)}
                />
              ) : (
                <>
                  <span className="thread-item-title">
                    {s.title?.trim() || 'Ny tråd'}
                  </span>
                  <span className="thread-item-meta">{formatRelative(s.lastActiveAt)}</span>
                </>
              )}

              {!isEditing && (
                <div className="thread-item-actions">
                  <button
                    type="button"
                    className="thread-item-more"
                    aria-label="Flere handlinger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === s.id ? null : s.id);
                    }}
                  >
                    ⋯
                  </button>
                  {menuId === s.id && (
                    <div
                      className="thread-item-menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="thread-item-menu-row"
                        onClick={() => {
                          setEditValue(s.title?.trim() || '');
                          setEditingId(s.id);
                          setMenuId(null);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="thread-item-menu-row thread-item-menu-row-danger"
                        onClick={() => {
                          setMenuId(null);
                          void archive(s.id);
                        }}
                      >
                        Arkiver
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="thread-rail-foot">
        <button
          type="button"
          className={`thread-item thread-item-static ${
            active.kind === 'telegram' ? 'thread-item-active' : ''
          }`}
          onClick={() => onSelect({ kind: 'telegram' })}
        >
          <span className="thread-item-title">Telegram-logg</span>
          <span className="thread-item-meta">les</span>
        </button>
      </div>
    </aside>
  );
}
