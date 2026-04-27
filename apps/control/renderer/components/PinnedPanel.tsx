'use client';
import { useEffect, useState } from 'react';
import { listPinned, togglePin } from '../lib/api';
import type { PinnedMessage } from '../../src/server-types';

export interface PinnedPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Navigate to the thread that owns the pinned message. Closes the panel
   * after navigation. Telegram-pinned messages don't have a controlSessionId
   * so we skip navigation for those.
   */
  onSelectThread: (controlSessionId: string) => void;
}

/**
 * Side panel listing every pinned message across all threads. Click a row
 * to jump to its thread; click the star to unpin in-place. Re-fetches when
 * the panel opens so the count matches the footer pill badge.
 */
export function PinnedPanel({ open, onClose, onSelectThread }: PinnedPanelProps) {
  const [pinned, setPinned] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void listPinned()
      .then(setPinned)
      .catch((e: Error) => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function unpin(id: string) {
    // Optimistic — remove from local list, then send the toggle.
    setPinned((prev) => prev.filter((p) => p.id !== id));
    try {
      await togglePin(id);
    } catch {
      // Revert by refetching on next open. For now leave the optimistic
      // removal so the user gets feedback — a stale pin will reappear on
      // refresh.
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Click-outside catcher */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 140,
          background: 'rgba(0,0,0,0.30)',
        }}
      />
      <div className="pinned-panel" role="dialog" aria-label="Pinet meldinger">
        <div className="pinned-panel-head">
          <span>Pinet meldinger ({pinned.length})</span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onClose}
            aria-label="Lukk"
          >
            ×
          </button>
        </div>
        <div className="pinned-panel-list">
          {loading && (
            <div className="global-search-empty">Laster pinet meldinger…</div>
          )}
          {error && <div className="global-search-empty">Feil: {error}</div>}
          {!loading && !error && pinned.length === 0 && (
            <div className="global-search-empty">
              Ingen pinet meldinger ennå. Trykk stjerneikonet på en melding.
            </div>
          )}
          {pinned.map((p) => (
            <div key={p.id} className="pinned-row">
              <div className="pinned-row-meta">
                <span>
                  {p.sessionTitle || 'Tråd'} ·{' '}
                  {new Date(p.createdAt).toLocaleString('nb-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}{' '}
                  · {p.role === 'user' ? 'Du' : 'Sean'}
                </span>
                <button
                  type="button"
                  className="pin-btn pin-btn-active"
                  onClick={(e) => {
                    e.stopPropagation();
                    void unpin(p.id);
                  }}
                  title="Avfest"
                  aria-label="Avfest"
                >
                  ★
                </button>
              </div>
              <button
                type="button"
                className="pinned-row-content"
                onClick={() => {
                  if (p.controlSessionId) {
                    onSelectThread(p.controlSessionId);
                    onClose();
                  }
                }}
                disabled={!p.controlSessionId}
                style={{
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  textAlign: 'left',
                  width: '100%',
                  cursor: p.controlSessionId ? 'pointer' : 'default',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                {p.content.slice(0, 280)}
                {p.content.length > 280 && '…'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
