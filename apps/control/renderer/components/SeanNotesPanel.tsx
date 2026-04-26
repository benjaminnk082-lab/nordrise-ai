'use client';
import { useCallback, useEffect, useState } from 'react';
import { vaultApi, formatRelative, type SeanNote } from '../lib/vault';

export interface SeanNotesPanelProps {
  open: boolean;
  onClose: () => void;
  vaultRoot: string;
  /** Triggered after adopt/dismiss so the parent can refresh the count. */
  onAfterAction?: () => void;
}

export function SeanNotesPanel({
  open,
  onClose,
  vaultRoot,
  onAfterAction,
}: SeanNotesPanelProps) {
  const [notes, setNotes] = useState<SeanNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await vaultApi.listSeanNotes();
      setNotes(list);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function adopt(path: string) {
    if (!vaultRoot) {
      setError('Velg vault-mappe i Innstillinger først.');
      return;
    }
    setBusyPath(path);
    try {
      await vaultApi.adoptNote(path, vaultRoot);
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyPath(null);
    }
  }

  async function dismiss(path: string) {
    setBusyPath(path);
    try {
      await vaultApi.dismissNote(path);
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyPath(null);
    }
  }

  if (!open) return null;

  return (
    <div className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-modal sean-notes-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <div className="qt-modal-head">
          <span className="qt-manager-title">Sean&apos;s notater</span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onClose}
            aria-label="Lukk"
          >
            ×
          </button>
        </div>

        <div className="settings-body">
          <p className="settings-section-sub">
            Forslag fra Sean. <strong>Lagre i vault</strong> kopierer fila til{' '}
            <code>&lt;vault&gt;/Sean/&lt;filnavn&gt;</code> og fjerner den fra
            kø. Sean kan ikke skrive direkte til vaulten.
          </p>

          {error && (
            <div className="settings-status settings-status-fail">{error}</div>
          )}

          {loading && notes.length === 0 && (
            <div className="settings-status settings-status-idle">Laster…</div>
          )}

          {!loading && notes.length === 0 && (
            <div className="settings-status settings-status-idle">
              Ingen forslag i kø.
            </div>
          )}

          {notes.map((note) => (
            <div
              key={note.path}
              className="sean-note-card"
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 10,
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: 12,
                    color: 'rgba(244,244,247,0.85)',
                  }}
                >
                  {note.path}
                </span>
                <span
                  style={{ fontSize: 11, color: 'rgba(244,244,247,0.5)' }}
                >
                  {formatRelative(note.mtime)}
                </span>
              </header>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.45)',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: 'rgba(244,244,247,0.7)',
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {note.content.length > 800
                  ? note.content.slice(0, 800) + '…'
                  : note.content}
              </pre>
              <div className="settings-actions-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="qt-btn-primary"
                  disabled={busyPath === note.path || !vaultRoot}
                  onClick={() => void adopt(note.path)}
                >
                  {busyPath === note.path ? 'Lagrer…' : 'Lagre i vault'}
                </button>
                <button
                  type="button"
                  className="qt-btn-secondary"
                  disabled={busyPath === note.path}
                  onClick={() => void dismiss(note.path)}
                >
                  Avvis
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
