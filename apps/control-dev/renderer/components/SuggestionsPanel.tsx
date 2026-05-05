'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SuggestionSummary, SuggestionType } from '../../src/server-types';
import {
  listSuggestions,
  approveSuggestion,
  rejectSuggestion,
  deleteSuggestion,
  generateSuggestionsNow,
} from '../lib/api';

export interface SuggestionsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Triggered after approve/reject/generate so the parent pill can refresh. */
  onAfterAction?: () => void;
}

const TYPE_ICON: Record<SuggestionType, string> = {
  research: '🔎',
  cleanup: '🧹',
  check: '✓',
  remind: '⏰',
  idea: '💡',
  note: '📝',
};

const TYPE_LABEL: Record<SuggestionType, string> = {
  research: 'Undersøk',
  cleanup: 'Rydd',
  check: 'Sjekk',
  remind: 'Påminnelse',
  idea: 'Idé',
  note: 'Notat',
};

export function SuggestionsPanel({
  open,
  onClose,
  onAfterAction,
}: SuggestionsPanelProps) {
  const [items, setItems] = useState<SuggestionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pull pending + recently-completed (last 50 of each tier).
      const all = await listSuggestions();
      setItems(all);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Light polling while open so an approval's status flips
    // pending → approved → done in front of the user.
    const t = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(t);
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

  async function approve(id: string) {
    setBusyId(id);
    try {
      await approveSuggestion(id);
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      await rejectSuggestion(id);
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteSuggestion(id);
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenStatus(null);
    try {
      const r = await generateSuggestionsNow();
      if (r.skipped) {
        setGenStatus(`Hoppet over: ${r.reason ?? 'ukjent'}`);
      } else {
        setGenStatus(`Genererte ${r.generated} forslag`);
      }
      await refresh();
      onAfterAction?.();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setGenerating(false);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!open) return null;

  const pending = items.filter((s) => s.status === 'pending');
  const approved = items.filter(
    (s) => s.status === 'approved' || (s.status === 'done' && wasRecent(s.executedAt)),
  );
  const completed = items.filter(
    (s) =>
      s.status === 'done' || s.status === 'failed' || s.status === 'rejected' || s.status === 'expired',
  );

  return (
    <div className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-modal sean-notes-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720 }}
      >
        <div className="qt-modal-head">
          <span className="qt-manager-title">Forslag fra Sean</span>
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
            Sean foreslår oppgaver han kunne utføre når du har vært inaktiv en
            stund. Godkjenn med ett klikk; han kjører den i en egen kontroll-sesjon.
          </p>

          <div
            className="settings-actions-row"
            style={{ marginBottom: 12, justifyContent: 'space-between' }}
          >
            <button
              type="button"
              className="qt-btn-secondary"
              disabled={generating}
              onClick={() => void generate()}
            >
              {generating ? 'Genererer…' : 'Generer nå'}
            </button>
            {genStatus && (
              <span style={{ fontSize: 11, color: 'rgba(244,244,247,0.6)' }}>
                {genStatus}
              </span>
            )}
          </div>

          {error && (
            <div className="settings-status settings-status-fail">{error}</div>
          )}

          {loading && items.length === 0 && (
            <div className="settings-status settings-status-idle">Laster…</div>
          )}

          {!loading && items.length === 0 && (
            <div className="settings-status settings-status-idle">
              Sean har ingen forslag akkurat nå. Han genererer nye automatisk når
              du har vært inaktiv en stund.
            </div>
          )}

          {pending.length > 0 && (
            <SectionHeader>Venter ({pending.length})</SectionHeader>
          )}
          {pending.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              expanded={expanded.has(s.id)}
              onToggleExpand={() => toggleExpand(s.id)}
              busy={busyId === s.id}
              onApprove={() => void approve(s.id)}
              onReject={() => void reject(s.id)}
              onDelete={() => void remove(s.id)}
            />
          ))}

          {approved.length > 0 && (
            <SectionHeader>Kjører ({approved.length})</SectionHeader>
          )}
          {approved.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              expanded={expanded.has(s.id)}
              onToggleExpand={() => toggleExpand(s.id)}
              busy={busyId === s.id}
              onApprove={() => void approve(s.id)}
              onReject={() => void reject(s.id)}
              onDelete={() => void remove(s.id)}
            />
          ))}

          {completed.length > 0 && (
            <SectionHeader>Historikk ({completed.length})</SectionHeader>
          )}
          {completed.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              expanded={expanded.has(s.id)}
              onToggleExpand={() => toggleExpand(s.id)}
              busy={busyId === s.id}
              onApprove={() => void approve(s.id)}
              onReject={() => void reject(s.id)}
              onDelete={() => void remove(s.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        marginBottom: 4,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'rgba(244,244,247,0.55)',
      }}
    >
      {children}
    </div>
  );
}

function SuggestionCard({
  s,
  expanded,
  onToggleExpand,
  busy,
  onApprove,
  onReject,
  onDelete,
}: {
  s: SuggestionSummary;
  expanded: boolean;
  onToggleExpand: () => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const collapsed = s.status === 'done' || s.status === 'rejected' || s.status === 'expired';
  const klass =
    s.status === 'pending'
      ? 'suggestion-pending'
      : s.status === 'failed'
        ? 'suggestion-failed'
        : s.status === 'done'
          ? 'suggestion-done'
          : '';
  return (
    <div
      className={`suggestion-card ${klass}`}
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 10,
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span aria-hidden style={{ fontSize: 14 }}>
          {TYPE_ICON[s.type]}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(244,244,247,0.55)' }}>
          {TYPE_LABEL[s.type]}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 999,
            background: statusBg(s.status),
            color: statusFg(s.status),
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {statusLabel(s.status)}
        </span>
      </header>
      <div
        style={{
          fontWeight: 600,
          color: '#f4f4f7',
          fontSize: 13,
          lineHeight: 1.35,
        }}
      >
        {s.title}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'rgba(244,244,247,0.6)',
          marginTop: 4,
          lineHeight: 1.45,
        }}
      >
        {s.rationale}
      </div>

      {!collapsed && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="link-button"
          style={{ fontSize: 11, marginTop: 6, padding: 0 }}
        >
          {expanded ? 'Skjul detaljer' : 'Sean ville kjørt…'}
        </button>
      )}

      {expanded && (
        <pre
          style={{
            margin: '8px 0 0',
            padding: 8,
            borderRadius: 6,
            background: 'rgba(0,0,0,0.45)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'rgba(244,244,247,0.78)',
            maxHeight: 200,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {s.prompt}
        </pre>
      )}

      {s.result && (s.status === 'done' || s.status === 'failed') && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{ fontSize: 11, color: 'rgba(167,139,255,0.85)', cursor: 'pointer' }}
          >
            {s.status === 'failed' ? 'Feil' : 'Resultat'}
          </summary>
          <pre
            style={{
              margin: '6px 0 0',
              padding: 8,
              borderRadius: 6,
              background: 'rgba(0,0,0,0.45)',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 11,
              lineHeight: 1.5,
              color: 'rgba(244,244,247,0.78)',
              maxHeight: 240,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {s.status === 'failed' ? s.errorMsg ?? 'Ukjent feil' : s.result}
          </pre>
        </details>
      )}

      {s.status === 'failed' && !s.result && s.errorMsg && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'rgba(255,138,138,0.85)',
          }}
        >
          {s.errorMsg}
        </div>
      )}

      <div className="settings-actions-row" style={{ marginTop: 10 }}>
        {s.status === 'pending' && (
          <>
            <button
              type="button"
              className="qt-btn-primary"
              disabled={busy}
              onClick={onApprove}
            >
              {busy ? 'Sender…' : 'Godkjenn'}
            </button>
            <button
              type="button"
              className="qt-btn-secondary"
              disabled={busy}
              onClick={onReject}
            >
              Avvis
            </button>
          </>
        )}
        {s.status !== 'pending' && (
          <button
            type="button"
            className="qt-btn-secondary"
            disabled={busy}
            onClick={onDelete}
          >
            Fjern
          </button>
        )}
      </div>
    </div>
  );
}

function statusLabel(s: SuggestionSummary['status']): string {
  switch (s) {
    case 'pending':
      return 'Venter';
    case 'approved':
      return 'Kjører';
    case 'rejected':
      return 'Avvist';
    case 'done':
      return 'Ferdig';
    case 'failed':
      return 'Feilet';
    case 'expired':
      return 'Utløpt';
  }
}

function statusBg(s: SuggestionSummary['status']): string {
  switch (s) {
    case 'pending':
      return 'rgba(167,139,255,0.18)';
    case 'approved':
      return 'rgba(127,221,166,0.18)';
    case 'done':
      return 'rgba(127,221,166,0.14)';
    case 'failed':
      return 'rgba(255,91,91,0.18)';
    case 'rejected':
    case 'expired':
    default:
      return 'rgba(244,244,247,0.08)';
  }
}

function statusFg(s: SuggestionSummary['status']): string {
  switch (s) {
    case 'pending':
      return '#c9b8ff';
    case 'approved':
      return '#9bf0c0';
    case 'done':
      return '#9bf0c0';
    case 'failed':
      return '#ff9b9b';
    case 'rejected':
    case 'expired':
    default:
      return 'rgba(244,244,247,0.6)';
  }
}

function wasRecent(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 60 * 60 * 1000; // last hour
}
