'use client';

/**
 * StatusBar — slim bottom bar showing per-session metadata.
 *
 * Skeleton: model id + token count + cost. The numbers are placeholders
 * for now; the wiring for live tokens/cost lives in Fase 3 (the SSE
 * `done` frame already carries `costUsdInformational` and the gateway
 * exposes `result.tokens` we can persist to the Message row).
 *
 * Kept as a separate component so Fase 3's live-data wiring is a small,
 * isolated diff inside this file.
 */

export interface StatusBarProps {
  modelLabel: string;
  /** Tokens for the current session. `null` while we're still loading. */
  tokens: number | null;
  /** Cost in USD; rendered with $0.00X precision. `null` while loading. */
  costUsd: number | null;
  /** Optional version string shown right-aligned. */
  version?: string;
  /** Trailing right-side action buttons (Sean's notes, search, …). */
  trailing?: React.ReactNode;
}

function fmtTokens(n: number | null): string {
  if (n === null) return '—';
  if (n < 1_000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function fmtCost(usd: number | null): string {
  if (usd === null) return '—';
  if (usd === 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function StatusBar({
  modelLabel,
  tokens,
  costUsd,
  version,
  trailing,
}: StatusBarProps) {
  return (
    <footer className="sb-bar" role="contentinfo" aria-label="Statusbar">
      <span className="sb-item sb-item-strong" title="Aktiv modell">
        <span className="sb-dot" aria-hidden="true" />
        {modelLabel}
      </span>
      <span className="sb-item" title="Tokens i denne tråden">
        ⌬ {fmtTokens(tokens)}
      </span>
      <span className="sb-item" title="Estimert kostnad (Max-subscription er flat)">
        {fmtCost(costUsd)}
      </span>
      <span className="sb-spacer" />
      {trailing}
      {version && <span className="sb-item" title="App-versjon">v{version}</span>}
    </footer>
  );
}
