'use client';
import type { AppSettings } from '../lib/settings';

/**
 * ConnectorRail — compact status bar shown above the thread list.
 *
 * Each pill represents a configured connector. Color encodes state:
 *   - green: enabled AND has the credentials it needs
 *   - amber: enabled but missing creds (toggled on without setup)
 *   - dim:   disabled (still rendered so the user can click to set up)
 *
 * Click → opens the Connectors tab in settings, scrolled to the row.
 */

type ConnectorKey =
  | 'firecrawl'
  | 'github'
  | 'vercel'
  | 'teams'
  | 'itslearning'
  | 'visma';

interface ConnectorMeta {
  key: ConnectorKey;
  icon: string;
  label: string;
  /** Returns true when the connector has the minimum creds it needs. */
  hasCreds: (s: AppSettings) => boolean;
}

const CONNECTORS: ConnectorMeta[] = [
  {
    key: 'teams',
    icon: '👥',
    label: 'Teams',
    hasCreds: (s) =>
      !!(
        s.connectors?.teams?.refreshToken?.trim() &&
        s.connectors?.teams?.clientId?.trim()
      ),
  },
  {
    key: 'itslearning',
    icon: '📚',
    label: 'Itslearning',
    hasCreds: (s) =>
      !!(
        s.connectors?.itslearning?.site?.trim() &&
        s.connectors?.itslearning?.clientId?.trim() &&
        s.connectors?.itslearning?.refreshToken?.trim()
      ),
  },
  {
    key: 'visma',
    icon: '🏫',
    label: 'Visma',
    hasCreds: (s) =>
      !!(
        s.connectors?.visma?.school?.trim() &&
        s.connectors?.visma?.cookie?.trim()
      ),
  },
  {
    key: 'github',
    icon: '🐙',
    label: 'GitHub',
    hasCreds: (s) => !!s.connectors?.github?.token?.trim(),
  },
  {
    key: 'firecrawl',
    icon: '🌐',
    label: 'Firecrawl',
    hasCreds: (s) => !!s.connectors?.firecrawl?.apiKey?.trim(),
  },
  {
    key: 'vercel',
    icon: '🚀',
    label: 'Vercel',
    hasCreds: (s) => !!s.connectors?.vercel?.token?.trim(),
  },
];

export interface ConnectorRailProps {
  settings: AppSettings;
  onOpenConnectors: (focusKey?: ConnectorKey) => void;
}

export function ConnectorRail({ settings, onOpenConnectors }: ConnectorRailProps) {
  return (
    <div className="connector-rail" role="toolbar" aria-label="Connectors">
      {CONNECTORS.map((c) => {
        const cfg = settings.connectors?.[c.key];
        const enabled = !!cfg?.enabled;
        const ready = enabled && c.hasCreds(settings);
        const status: 'ready' | 'missing' | 'off' = ready
          ? 'ready'
          : enabled
            ? 'missing'
            : 'off';
        const title =
          status === 'ready'
            ? `${c.label}: aktiv`
            : status === 'missing'
              ? `${c.label}: påslått, men mangler nøkler — klikk for å sette opp`
              : `${c.label}: ikke aktivert — klikk for å sette opp`;
        return (
          <button
            key={c.key}
            type="button"
            className={`connector-rail-pill connector-rail-${status}`}
            title={title}
            onClick={() => onOpenConnectors(c.key)}
          >
            <span className="connector-rail-dot" aria-hidden="true" />
            <span className="connector-rail-icon" aria-hidden="true">
              {c.icon}
            </span>
            <span className="connector-rail-label">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export type { ConnectorKey };
