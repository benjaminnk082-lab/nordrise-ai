'use client';
import { useEffect, useState } from 'react';
import { updateSession } from '../lib/api';

export interface ThreadSettingsModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  threadTitle: string;
  /** Current persisted prompt (null = none). */
  currentPrompt: string | null;
  /** Called after a successful save/clear with the new value. */
  onSaved: (next: string | null) => void;
}

const MAX_PROMPT = 5000;

/**
 * Per-thread system-prompt editor. The value is appended after Sean's
 * persona via `--append-system-prompt` for every message in this thread —
 * so think of it as a thread-scoped instruction layer, not a replacement.
 */
export function ThreadSettingsModal({
  open,
  onClose,
  sessionId,
  threadTitle,
  currentPrompt,
  onSaved,
}: ThreadSettingsModalProps) {
  const [draft, setDraft] = useState(currentPrompt ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset draft each time the modal opens with a different thread or
  // persisted value — otherwise switching threads would leak state.
  useEffect(() => {
    if (open) {
      setDraft(currentPrompt ?? '');
      setError(null);
    }
  }, [open, currentPrompt, sessionId]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Empty string clears (server treats whitespace-only as null).
      const trimmed = draft.trim();
      const next = trimmed.length === 0 ? null : trimmed;
      await updateSession(sessionId, { systemPrompt: next });
      onSaved(next);
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await updateSession(sessionId, { systemPrompt: null });
      onSaved(null);
      setDraft('');
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const overLimit = draft.length > MAX_PROMPT;

  return (
    <div className="qt-modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="qt-modal thread-settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <div className="qt-modal-head">
          <span className="qt-manager-title">
            Innstillinger for {threadTitle ? `"${threadTitle}"` : 'tråden'}
          </span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onClose}
            aria-label="Lukk"
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Tråd-spesifikk system-prompt</h3>
            <p className="settings-section-sub">
              Slik blir Sean instruert i kun denne tråden,{' '}
              <strong>i tillegg til</strong> hovedpersonaen. Bruk den for
              kontekst som "vi snakker bare om regnskap" eller "svar på engelsk".
              La feltet stå tomt for å bruke kun standard-personaen.
            </p>
            <textarea
              className="settings-field-input thread-settings-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="F.eks. 'Du er nå i en regnskapssesjon — alle svar skal referere til norsk skattelovgivning og bruke NOK.'"
              rows={8}
              spellCheck
              maxLength={MAX_PROMPT + 100}
              style={{
                width: '100%',
                minHeight: 140,
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />
            <div
              className="settings-section-sub"
              style={{ display: 'flex', justifyContent: 'space-between' }}
            >
              <span>{overLimit && `For lang — maks ${MAX_PROMPT} tegn.`}</span>
              <span style={{ opacity: 0.6 }}>{draft.length} / {MAX_PROMPT}</span>
            </div>
            {error && (
              <div className="settings-status settings-status-fail" style={{ marginTop: 8 }}>
                {error}
              </div>
            )}
            <div className="settings-actions-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="qt-btn-primary"
                disabled={busy || overLimit}
                onClick={() => void save()}
              >
                {busy ? 'Lagrer…' : 'Lagre'}
              </button>
              {currentPrompt !== null && (
                <button
                  type="button"
                  className="qt-btn-secondary"
                  disabled={busy}
                  onClick={() => void clear()}
                >
                  Nullstill
                </button>
              )}
              <button
                type="button"
                className="qt-btn-secondary"
                disabled={busy}
                onClick={onClose}
              >
                Avbryt
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
