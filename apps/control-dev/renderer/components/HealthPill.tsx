'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  phase3Heartbeat,
  phase3Errors,
  pingHealthz,
  type HeartbeatStatus,
} from '../lib/bridge';

/**
 * HealthPill — single dot in the StatusBar trailing slot.
 *
 *   green  = gateway reachable + DB ok + heartbeat running (or paused
 *            but no recent error)
 *   yellow = degraded gateway/DB OR heartbeat reports lastError
 *   red    = gateway unreachable OR DB error OR no recent errors:tail
 *            response (i.e. main process crashed)
 *
 * Hovering / clicking expands a popover with the underlying signals
 * + a "tail errors.md" peek.
 */

type Health = 'green' | 'yellow' | 'red';

interface HealthSnapshot {
  health: Health;
  reasons: string[];
  heartbeat: HeartbeatStatus | null;
  gatewayStatus: 'ok' | 'degraded' | 'down';
  recentErrorsCount: number;
  /** ISO of last successful round-trip. */
  checkedAt: string;
}

const initialSnapshot: HealthSnapshot = {
  health: 'red',
  reasons: ['initialising'],
  heartbeat: null,
  gatewayStatus: 'down',
  recentErrorsCount: 0,
  checkedAt: '',
};

export function HealthPill() {
  const [snap, setSnap] = useState<HealthSnapshot>(initialSnapshot);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const reasons: string[] = [];

    // Gateway / DB — single round-trip via existing healthz IPC.
    let gatewayStatus: 'ok' | 'degraded' | 'down' = 'down';
    try {
      const h = await pingHealthz();
      const body = (h.body ?? null) as
        | { status?: 'ok' | 'degraded'; db?: 'ok' | 'error'; authMode?: string }
        | null;
      if (h.status === 200 && body) {
        if (body.db === 'error') {
          gatewayStatus = 'degraded';
          reasons.push('DB error');
        } else if (body.status === 'ok' && body.authMode === 'subscription') {
          gatewayStatus = 'ok';
        } else {
          gatewayStatus = 'degraded';
          reasons.push(`status=${body.status}`);
        }
      } else {
        reasons.push(`gateway http_${h.status}`);
      }
    } catch (err) {
      reasons.push(`gateway: ${(err as Error).message}`);
    }

    // Heartbeat — existing state from main.
    let heartbeat: HeartbeatStatus | null = null;
    try {
      heartbeat = await phase3Heartbeat.status();
      if (heartbeat?.lastError) reasons.push(`heartbeat: ${heartbeat.lastError}`);
    } catch (err) {
      reasons.push(`heartbeat ipc: ${(err as Error).message}`);
    }

    // Recent errors.md.
    let recentErrorsCount = 0;
    try {
      const tail = await phase3Errors.tail(10);
      recentErrorsCount = tail.length;
    } catch {
      // errors:tail returns [] on missing file — hard error here only if IPC layer is dead
      reasons.push('errors:tail unreachable');
    }

    let health: Health = 'green';
    if (gatewayStatus === 'down' || reasons.some((r) => /unreachable|down/.test(r))) {
      health = 'red';
    } else if (
      gatewayStatus === 'degraded' ||
      heartbeat?.lastError ||
      recentErrorsCount > 5
    ) {
      health = 'yellow';
    }

    setSnap({
      health,
      reasons,
      heartbeat,
      gatewayStatus,
      recentErrorsCount,
      checkedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    const off = phase3Heartbeat.subscribe((s) => {
      setSnap((prev) => ({ ...prev, heartbeat: s }));
    });
    return () => {
      clearInterval(t);
      off();
    };
  }, [refresh]);

  const dotClass =
    snap.health === 'green'
      ? 'sb-dot health-green'
      : snap.health === 'yellow'
        ? 'sb-dot health-yellow'
        : 'sb-dot health-red';

  const label =
    snap.health === 'green'
      ? 'OK'
      : snap.health === 'yellow'
        ? 'Degraded'
        : 'Down';

  return (
    <span className="sb-item" style={{ position: 'relative' }}>
      <button
        type="button"
        className="sb-action"
        onClick={() => setOpen((v) => !v)}
        title={`Health: ${label}\n${snap.reasons.join('\n') || 'all signals green'}`}
      >
        <span className={dotClass} aria-hidden="true" />
        <span style={{ marginLeft: 4 }}>{label}</span>
      </button>
      {open && <HealthPopover snap={snap} onClose={() => setOpen(false)} />}
    </span>
  );
}

function HealthPopover({
  snap,
  onClose,
}: {
  snap: HealthSnapshot;
  onClose: () => void;
}) {
  const [errs, setErrs] = useState<string[]>([]);
  useEffect(() => {
    void phase3Errors.tail(5).then(setErrs);
  }, []);
  return (
    <div
      role="dialog"
      aria-label="Health details"
      style={{
        position: 'absolute',
        right: 0,
        bottom: 'calc(100% + 6px)',
        width: 360,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-elev)',
        padding: 'var(--space-3)',
        zIndex: 50,
        fontSize: 12,
        color: 'var(--text)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600 }}>Health</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {snap.checkedAt ? new Date(snap.checkedAt).toLocaleTimeString() : '—'}
        </span>
        <button
          type="button"
          className="link-button"
          onClick={onClose}
          style={{ marginLeft: 'auto', fontSize: 11 }}
        >
          ✕
        </button>
      </div>

      <table
        style={{
          width: '100%',
          marginTop: 8,
          borderCollapse: 'collapse',
          fontSize: 11,
        }}
      >
        <tbody>
          <tr>
            <td style={{ color: 'var(--text-muted)', padding: '2px 4px' }}>
              Gateway
            </td>
            <td style={{ padding: '2px 4px' }}>{snap.gatewayStatus}</td>
          </tr>
          <tr>
            <td style={{ color: 'var(--text-muted)', padding: '2px 4px' }}>
              Heartbeat
            </td>
            <td style={{ padding: '2px 4px' }}>
              {snap.heartbeat?.state ?? 'unknown'}
              {snap.heartbeat?.lastTickAt && (
                <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                  · last {new Date(snap.heartbeat.lastTickAt).toLocaleTimeString()}
                </span>
              )}
            </td>
          </tr>
          <tr>
            <td style={{ color: 'var(--text-muted)', padding: '2px 4px' }}>
              Recent errors
            </td>
            <td style={{ padding: '2px 4px' }}>{snap.recentErrorsCount}</td>
          </tr>
        </tbody>
      </table>

      {errs.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
            Last errors.md entries
          </summary>
          <pre
            style={{
              fontSize: 10,
              maxHeight: 160,
              overflow: 'auto',
              background: 'var(--bg-sunken)',
              padding: 6,
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              marginTop: 6,
            }}
          >
            {errs.join('\n').slice(-2000)}
          </pre>
        </details>
      )}
    </div>
  );
}
