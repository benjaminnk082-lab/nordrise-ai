'use client';
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

export function ThreadList({
  sessions,
  active,
  onSelect,
  onNew,
  loading,
}: ThreadListProps) {
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
          <div className="thread-empty">Laster tråder…</div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="thread-empty">Ingen tråder enda. Start en ny.</div>
        )}
        {sessions.map((s) => {
          const isActive = active.kind === 'session' && active.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              className={`thread-item ${isActive ? 'thread-item-active' : ''}`}
              onClick={() => onSelect({ kind: 'session', id: s.id })}
            >
              <span className="thread-item-title">
                {s.title?.trim() || 'Ny tråd'}
              </span>
              <span className="thread-item-meta">{formatRelative(s.lastActiveAt)}</span>
            </button>
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
