'use client';
import { useState, useCallback } from 'react';
import {
  phase3Lighthouse,
  type LighthouseAudit,
} from '../lib/bridge';

/**
 * LighthousePanel — modal that runs a Google Lighthouse audit against a
 * URL and renders the summary card per the Anthropic-skill spec
 * (`apps/control[-dev]/main/seed-skills/lighthouse-audit/SKILL.md`).
 *
 * The actual audit happens in the main process via `lighthouse:run` IPC
 * → `lib/lighthouseRunner.runLighthouse`. When `lighthouse` and
 * `chrome-launcher` aren't installed (default state for this branch),
 * the runner returns a stub audit that explains the install command —
 * the panel surfaces it as a "setup required" warning instead of
 * crashing. The user runs:
 *
 *   npm install --prefix apps/control-dev lighthouse chrome-launcher
 *
 * and the next audit returns real scores.
 */
export interface LighthousePanelProps {
  open: boolean;
  onClose: () => void;
  /** Optional vault root — when set, full JSON dumps land in
   * <vault>/Sean/audits/<date>-<host>.json. */
  vaultRoot?: string;
}

export function LighthousePanel({ open, onClose, vaultRoot }: LighthousePanelProps) {
  const [url, setUrl] = useState('https://example.com');
  const [formFactor, setFormFactor] = useState<'mobile' | 'desktop'>('mobile');
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState<LighthouseAudit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setAudit(null);
    try {
      const r = await phase3Lighthouse.run({ url, formFactor, vaultRoot });
      setAudit(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }, [url, formFactor, vaultRoot]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-palette"
        style={{ width: 'min(640px, 92vw)', padding: 'var(--space-5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            Lighthouse-audit
          </div>
          <button
            type="button"
            className="link-button"
            onClick={onClose}
            style={{ marginLeft: 'auto' }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-3)' }}>
          <input
            type="url"
            className="composer-input"
            placeholder="https://eksempel.no"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--text)',
            }}
          />
          <select
            value={formFactor}
            onChange={(e) => setFormFactor(e.target.value as 'mobile' | 'desktop')}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--text)',
            }}
          >
            <option value="mobile">Mobil</option>
            <option value="desktop">Desktop</option>
          </select>
          <button
            type="button"
            className="tb-icon-btn"
            data-emphasis="primary"
            onClick={() => void run()}
            disabled={running}
          >
            {running ? 'Kjører…' : 'Kjør audit'}
          </button>
        </div>

        {error && (
          <div role="alert" style={{ color: '#ffa3a3', fontSize: 12 }}>
            {error}
          </div>
        )}

        {audit && <LighthouseSummaryCard audit={audit} />}
      </div>
    </div>
  );
}

export function LighthouseSummaryCard({ audit }: { audit: LighthouseAudit }) {
  const setupRequired =
    audit.scores.performance === 0 &&
    audit.scores.accessibility === 0 &&
    audit.topIssues.some((i) => i.id === 'setup-required');

  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--surface)',
        border: '1px solid var(--separator)',
        borderRadius: 'var(--radius-md)',
        marginTop: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
          {audit.url}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
          {Math.round((audit.finishedAt - audit.startedAt) / 1000)}s
        </span>
      </div>

      {setupRequired ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'rgba(230,166,99,0.10)',
            border: '1px solid rgba(230,166,99,0.30)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 8,
          }}
        >
          {audit.topIssues[0]?.description}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <ScoreTile label="Perf" value={audit.scores.performance} />
          <ScoreTile label="A11y" value={audit.scores.accessibility} />
          <ScoreTile label="BP" value={audit.scores.bestPractices} />
          <ScoreTile label="SEO" value={audit.scores.seo} />
        </div>
      )}

      {audit.topIssues.length > 0 && !setupRequired && (
        <>
          <div
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.06,
              color: 'var(--text-faint)',
              marginBottom: 6,
            }}
          >
            Topp 3 saker å fikse
          </div>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            {audit.topIssues.map((i) => (
              <li
                key={i.id}
                style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}
              >
                <strong style={{ color: 'var(--text)' }}>{i.title}</strong>
                {' — '}
                {i.description}
                {i.impact !== 'qualitative' && i.impact !== 'n/a' && (
                  <span style={{ color: 'var(--text-faint)' }}> · {i.impact}</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {audit.jsonPath && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
          Full JSON: <code>{audit.jsonPath}</code>
        </div>
      )}
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  const color =
    value >= 90 ? '#6ec48a' : value >= 50 ? '#e6a663' : '#e0443e';
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--space-2)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--separator)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 600, color, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.05 }}>
        {label}
      </div>
    </div>
  );
}
