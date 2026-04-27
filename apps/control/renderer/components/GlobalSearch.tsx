'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listHistory, vaultSearch } from '../lib/api';
import type {
  ControlMessageRow,
  VaultSearchMatch,
} from '../../src/server-types';
import { openPath } from '../lib/bridge';

export interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  /**
   * Vault root path (absolute). Used to resolve a relative search-result path
   * to a real file the OS can open via shell.openPath. Empty string when the
   * vault is disabled — vault results in that case are non-clickable.
   */
  vaultRoot: string;
  /**
   * Navigate to a specific message. Parent flips the active selection to
   * the right thread; we don't currently scroll to the exact line (would
   * require a refresh-and-anchor primitive in ChatPane).
   */
  onSelectMessage: (controlSessionId: string, messageId: string) => void;
}

/**
 * GlobalSearch — Ctrl+F modal that searches across messages (client-side
 * filter on /control/history?source=all) and the vault (server-side via
 * /control/vault/search). Debounced 180ms so we don't hammer either
 * endpoint while the user types.
 */
export function GlobalSearch({
  open,
  onClose,
  vaultRoot,
  onSelectMessage,
}: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [allMessages, setAllMessages] = useState<ControlMessageRow[]>([]);
  const [vaultMatches, setVaultMatches] = useState<VaultSearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // On open, focus the input and pre-load history once. We re-fetch on each
  // open so newly-added messages are searchable without a stale cache.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setVaultMatches([]);
    inputRef.current?.focus();
    void (async () => {
      try {
        const rows = await listHistory('all', 500);
        setAllMessages(rows);
      } catch {
        setAllMessages([]);
      }
    })();
  }, [open]);

  // Debounced vault search. 2-char minimum mirrors the server guard.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setVaultMatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      void vaultSearch(q)
        .then((rows) => setVaultMatches(rows))
        .catch(() => setVaultMatches([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Esc closes; Enter on first result navigates.
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

  // Client-side filter for messages — case-insensitive substring on content.
  const matchedMessages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: ControlMessageRow[] = [];
    for (const m of allMessages) {
      if (out.length >= 50) break;
      if (m.content.toLowerCase().includes(q)) out.push(m);
    }
    return out;
  }, [allMessages, query]);

  if (!open) return null;

  function highlight(text: string): string {
    return text.length > 160 ? text.slice(0, 160) + '…' : text;
  }

  function renderHit(content: string) {
    const q = query.trim();
    if (q.length < 2) return highlight(content);
    const lower = content.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx < 0) return highlight(content);
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + q.length + 80);
    const before = (start > 0 ? '…' : '') + content.slice(start, idx);
    const hit = content.slice(idx, idx + q.length);
    const after = content.slice(idx + q.length, end) + (end < content.length ? '…' : '');
    return (
      <>
        {before}
        <mark>{hit}</mark>
        {after}
      </>
    );
  }

  return (
    <div
      className="global-search-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Søk i meldinger og vault"
    >
      <div className="global-search-card" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="global-search-input"
          type="text"
          placeholder="Søk i meldinger og vault…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <div className="global-search-results">
          {query.trim().length < 2 ? (
            <div className="global-search-empty">Skriv minst 2 tegn for å søke.</div>
          ) : (
            <>
              <div className="global-search-section-header">
                Meldinger ({matchedMessages.length})
              </div>
              {matchedMessages.length === 0 && (
                <div className="global-search-empty">Ingen treff i meldinger.</div>
              )}
              {matchedMessages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="global-search-result"
                  onClick={() => {
                    if (m.controlSessionId) {
                      onSelectMessage(m.controlSessionId, m.id);
                    }
                    onClose();
                  }}
                  style={{ background: 'none', border: 0 }}
                  disabled={!m.controlSessionId}
                  title={
                    m.controlSessionId ? 'Hopp til tråd' : 'Telegram-melding (ikke navigerbar)'
                  }
                >
                  <div className="global-search-result-title">
                    {m.role === 'user' ? 'Du' : 'Sean'} · {m.source} ·{' '}
                    {new Date(m.createdAt).toLocaleString('nb-NO', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </div>
                  <div className="global-search-snippet">{renderHit(m.content)}</div>
                </button>
              ))}

              <div className="global-search-section-header">
                Vault ({vaultMatches.length}
                {loading && '…'})
              </div>
              {!loading && vaultMatches.length === 0 && (
                <div className="global-search-empty">
                  {vaultRoot
                    ? 'Ingen treff i vault.'
                    : 'Vault er ikke koblet til. Aktiver synk i Innstillinger.'}
                </div>
              )}
              {vaultMatches.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  className="global-search-result"
                  onClick={() => {
                    if (vaultRoot) {
                      // Resolve relative -> absolute. The vault uses forward
                      // slashes; on Windows openPath accepts either.
                      const sep = vaultRoot.endsWith('/') || vaultRoot.endsWith('\\') ? '' : '/';
                      void openPath(`${vaultRoot}${sep}${v.path}`);
                    }
                    onClose();
                  }}
                  style={{ background: 'none', border: 0 }}
                  disabled={!vaultRoot}
                >
                  <div className="global-search-result-title">{v.path}</div>
                  {v.preview && (
                    <div className="global-search-snippet">{renderHit(v.preview)}</div>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="global-search-foot">
          <span>
            <span className="global-search-kbd">Esc</span> for å lukke
          </span>
          <span>
            <span className="global-search-kbd">Ctrl</span>+
            <span className="global-search-kbd">F</span> for å åpne
          </span>
        </div>
      </div>
    </div>
  );
}
