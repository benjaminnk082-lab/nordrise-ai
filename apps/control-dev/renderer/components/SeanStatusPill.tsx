'use client';
import { useEffect, useRef, useState } from 'react';
import { listRecentRuns, listSuggestions } from '../lib/api';
import { proactiveApi } from '../lib/proactive';

/**
 * Live "Sean jobber med X"-pill in the AppShell footer. Composes its label
 * from three async sources and picks whichever has the highest priority
 * (routine > suggestion > proactive > idle).
 *
 * Intentionally fire-and-forget: every fetch is wrapped in try/catch and
 * silently ignored on failure so the pill never breaks the footer if the
 * backend is offline or the user is logged out.
 */

type StatusKind = 'idle' | 'routine' | 'suggestion' | 'proactive';

interface ActivityState {
  kind: StatusKind;
  label: string;
  detail?: string;
}

const POLL_MS = 10_000;
const PROACTIVE_RECENCY_MS = 60_000;

function truncate(s: string | null | undefined, max = 32): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

export function SeanStatusPill() {
  const [state, setState] = useState<ActivityState>({
    kind: 'idle',
    label: 'Tilgjengelig',
  });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    async function poll() {
      // Run all three queries in parallel — they're independent. Errors on
      // any one fall back to "idle" rather than blocking the others.
      const [runs, approved, attempts] = await Promise.all([
        listRecentRuns().catch(() => []),
        listSuggestions('approved').catch(() => []),
        proactiveApi.attempts().catch(() => ({ attempts: [] })),
      ]);

      if (cancelledRef.current) return;

      // Priority 1: routine running
      const runningRoutine = runs.find((r) => r.status === 'running');
      if (runningRoutine) {
        setState({
          kind: 'routine',
          label: 'Jobber med routine',
          detail: truncate(runningRoutine.routineName, 28),
        });
        return;
      }

      // Priority 2: approved suggestion in flight (executedAt is null)
      const inFlight = approved.find((s) => s.executedAt == null);
      if (inFlight) {
        setState({
          kind: 'suggestion',
          label: 'Utfører forslag',
          detail: truncate(inFlight.title, 28),
        });
        return;
      }

      // Priority 3: proactive 'sent' decision in last 60s
      const list = attempts.attempts ?? [];
      const recent = list.find((a) => {
        if (a.decision !== 'sent') return false;
        const t = new Date(a.triggeredAt).getTime();
        return Number.isFinite(t) && Date.now() - t < PROACTIVE_RECENCY_MS;
      });
      if (recent) {
        setState({
          kind: 'proactive',
          label: 'Sendte proaktiv',
          detail: truncate(
            (recent.category as string | null) ?? 'melding',
            28,
          ),
        });
        return;
      }

      setState({ kind: 'idle', label: 'Tilgjengelig' });
    }

    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(t);
    };
  }, []);

  const isActive = state.kind !== 'idle';

  return (
    <div
      className={`sean-status sean-status-${state.kind}`}
      title={
        isActive
          ? `${state.label}${state.detail ? ` — ${state.detail}` : ''}`
          : 'Sean er ledig'
      }
    >
      <span className={`sean-status-dot ${isActive ? 'active' : 'idle'}`} />
      <span className="sean-status-label">{state.label}</span>
      {state.detail && (
        <span className="sean-status-detail"> · {state.detail}</span>
      )}
    </div>
  );
}
