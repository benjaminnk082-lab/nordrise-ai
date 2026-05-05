'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuggestionSummary } from '../../src/server-types';
import { listSuggestions } from '../lib/api';
import { SuggestionsPanel } from './SuggestionsPanel';

const POLL_MS = 30_000;
const PULSE_WINDOW_MS = 5 * 60 * 1000; // 5 min — matches "new" definition in spec.

export function SuggestionsPill() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<SuggestionSummary[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listSuggestions('pending');
      setPending(list);
      // Prime the seen-set on first load so existing rows don't all pulse
      // when the renderer launches.
      if (!initializedRef.current) {
        for (const s of list) seenIdsRef.current.add(s.id);
        initializedRef.current = true;
        return;
      }
      for (const s of list) {
        if (!seenIdsRef.current.has(s.id)) seenIdsRef.current.add(s.id);
      }
    } catch {
      // Silent — pill must never break the shell footer.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Pulse if any pending suggestion was created in the last 5 min.
  const hasFresh = pending.some(
    (s) => Date.now() - new Date(s.createdAt).getTime() < PULSE_WINDOW_MS,
  );

  return (
    <>
      <button
        type="button"
        className="link-button routines-pill"
        onClick={() => setOpen(true)}
        title="Forslag fra Sean"
      >
        {hasFresh && <span className="routines-pill-pulse" />}
        Forslag
        {pending.length > 0 && (
          <span
            style={{
              marginLeft: 6,
              padding: '1px 6px',
              borderRadius: 999,
              background: 'linear-gradient(90deg,#a78bff,#7c5cff)',
              color: '#0b0a13',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {pending.length}
          </span>
        )}
      </button>
      <SuggestionsPanel
        open={open}
        onClose={() => setOpen(false)}
        onAfterAction={() => void refresh()}
      />
    </>
  );
}
