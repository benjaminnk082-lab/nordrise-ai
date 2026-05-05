'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoutineRunRecent } from '../../src/server-types';
import { listRecentRuns } from '../lib/api';
import { explainCron } from '../lib/cron';

const POLL_MS = 30_000;
const PULSE_WINDOW_MS = 30_000;

export function RoutinesPill() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RoutineRunRecent[]>([]);
  const [loading, setLoading] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listRecentRuns();
      setRuns(list);
      // First poll just seeds the seen-set so we don't fire a flood of
      // notifications for already-finished runs on app launch.
      if (!initializedRef.current) {
        for (const r of list) seenIdsRef.current.add(r.id);
        initializedRef.current = true;
        return;
      }
      // Detect newly-successful runs (id not seen before, status=success).
      for (const r of list) {
        if (seenIdsRef.current.has(r.id)) continue;
        seenIdsRef.current.add(r.id);
        if (r.status === 'success') {
          void window.nordrise.invoke('routines:notify', {
            name: r.routineName,
            preview: r.result ?? '',
          });
        }
      }
    } catch {
      // Silent — pill should never crash the shell.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Pulse if any run finished within the pulse window.
  const recentSuccess = runs.find(
    (r) =>
      r.status === 'success' &&
      r.finishedAt &&
      Date.now() - new Date(r.finishedAt).getTime() < PULSE_WINDOW_MS,
  );

  async function handleOpen() {
    setOpen((v) => !v);
    if (!open) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  }

  return (
    <div className="routines-pill-wrap">
      <button
        type="button"
        className="link-button routines-pill"
        onClick={() => void handleOpen()}
        title="Rutiner"
      >
        {recentSuccess && <span className="routines-pill-pulse" />}
        Rutiner
      </button>
      {open && (
        <div className="routines-pop" onClick={(e) => e.stopPropagation()}>
          <div className="routines-pop-head">Siste kjøringer</div>
          {loading && <div className="routines-pop-empty">Henter…</div>}
          {!loading && runs.length === 0 && (
            <div className="routines-pop-empty">
              Ingen kjøringer ennå. Lag en rutine i Innstillinger.
            </div>
          )}
          <div className="routines-pop-list">
            {runs.slice(0, 10).map((r) => (
              <div key={r.id} className="routines-pop-row">
                <span
                  className={`routines-pop-status routines-pop-status-${r.status}`}
                  title={r.status}
                >
                  {r.status === 'success' ? '✓' : r.status === 'failed' ? '✗' : '…'}
                </span>
                <span className="routines-pop-name">{r.routineName}</span>
                <span className="routines-pop-time">
                  {formatRelative(r.finishedAt ?? r.startedAt)}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="routines-pop-close"
            onClick={() => setOpen(false)}
          >
            Lukk
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'nå';
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}t`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

// Re-export the cron helper too for any future inline use.
export { explainCron };
