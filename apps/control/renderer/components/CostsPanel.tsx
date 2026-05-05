'use client';
import { useEffect, useState, useCallback } from 'react';
import { projectsApi, usageApi } from '../lib/api';
import type { UsageSummaryResponse, ProjectRow } from '../../src/server-types';

/**
 * CostsPanel — slide-in panel showing token usage broken down by
 * project and by day. Wired to Phase 3 endpoints (`/control/projects`,
 * `/control/usage`, `/control/usage.csv`).
 *
 * "Cost" is informational on the Max subscription — the field is
 * reported by claude-code 1.0+ but not billed. Surfacing it lets the
 * user see "what would this have cost on the API" which is useful
 * for capacity planning.
 */

export interface CostsPanelProps {
  open: boolean;
  onClose: () => void;
}

function fmtTokens(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function CostsPanel({ open, onClose }: CostsPanelProps) {
  const [summary, setSummary] = useState<UsageSummaryResponse | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        usageApi.summary(),
        projectsApi.list(),
      ]);
      setSummary(s);
      setProjects(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const exportCsv = useCallback(async () => {
    try {
      const csv = await usageApi.csv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nordrise-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const createProject = useCallback(async () => {
    const name = window.prompt('Prosjektnavn:');
    if (!name?.trim()) return;
    try {
      await projectsApi.create(name.trim());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refresh]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Costs panel"
      className="qt-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="qt-palette"
        style={{ width: 'min(720px, 92vw)', padding: 'var(--space-5)', maxHeight: '80vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            Costs · siste 30 dager
          </div>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button type="button" className="link-button" onClick={() => void refresh()}>
              Oppdater
            </button>
            <button type="button" className="link-button" onClick={() => void exportCsv()}>
              Last ned CSV
            </button>
            <button type="button" className="link-button" onClick={() => void createProject()}>
              + Prosjekt
            </button>
            <button type="button" className="link-button" onClick={onClose}>
              ✕
            </button>
          </span>
        </div>

        {loading && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Laster…</div>
        )}
        {error && (
          <div role="alert" style={{ color: '#ffa3a3', fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}

        {summary && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <SummaryTile label="Input tokens" value={fmtTokens(summary.total.inputTokens)} />
              <SummaryTile label="Output tokens" value={fmtTokens(summary.total.outputTokens)} />
              <SummaryTile label="Cost (info)" value={fmtCost(summary.total.costUsd)} />
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Heading>Per prosjekt</Heading>
              {summary.byProject.length === 0 && (
                <Empty>Ingen aktivitet i vinduet.</Empty>
              )}
              {summary.byProject.length > 0 && (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <Tr>
                      <Th>Prosjekt</Th>
                      <Th align="right">Input</Th>
                      <Th align="right">Output</Th>
                      <Th align="right">Cost</Th>
                      <Th align="right">Sessions</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {summary.byProject.map((p) => (
                      <Tr key={p.projectId ?? '__null__'}>
                        <Td>
                          {p.projectName ?? <span style={{ color: 'var(--text-faint)' }}>(uten prosjekt)</span>}
                        </Td>
                        <Td align="right">{fmtTokens(p.inputTokens)}</Td>
                        <Td align="right">{fmtTokens(p.outputTokens)}</Td>
                        <Td align="right">{fmtCost(p.costUsd)}</Td>
                        <Td align="right">{p.sessionCount}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <Heading>Per dag</Heading>
              {summary.byDay.length === 0 && <Empty>Ingen aktivitet.</Empty>}
              {summary.byDay.length > 0 && (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <Tr>
                      <Th>Dato</Th>
                      <Th align="right">Input</Th>
                      <Th align="right">Output</Th>
                      <Th align="right">Cost</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {summary.byDay.map((d) => (
                      <Tr key={d.date}>
                        <Td>{d.date}</Td>
                        <Td align="right">{fmtTokens(d.inputTokens)}</Td>
                        <Td align="right">{fmtTokens(d.outputTokens)}</Td>
                        <Td align="right">{fmtCost(d.costUsd)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {projects.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Heading>Registrerte prosjekter ({projects.length})</Heading>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      style={{
                        padding: '4px 0',
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        borderBottom: '1px solid var(--separator)',
                      }}
                    >
                      <strong style={{ color: 'var(--text)' }}>{p.name}</strong>
                      {p.description && ` — ${p.description}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--separator)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.06,
        color: 'var(--text-faint)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--space-3)',
        color: 'var(--text-muted)',
        fontSize: 12,
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  );
}

function Tr({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: '1px solid var(--separator)' }}>{children}</tr>;
}
function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '6px 8px',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.05,
        color: 'var(--text-faint)',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td style={{ padding: '6px 8px', textAlign: align ?? 'left', color: 'var(--text)' }}>
      {children}
    </td>
  );
}
