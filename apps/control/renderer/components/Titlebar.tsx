'use client';
import { useEffect, useState } from 'react';
import {
  closeWindow,
  minimizeWindow,
  subscribeWindowState,
  toggleMaximizeWindow,
} from '../lib/bridge';
import type { AppSettings } from '../lib/settings';
import type { ConnectorKey } from './ConnectorRail';

/**
 * Titlebar — frameless-window chrome (replaces the OS titlebar).
 *
 *   [ ▣ Nordrise ]  [pill][pill][pill][pill][pill][pill]   [+ Ny]  [⚙]  [☀]    [—][▢][✕]
 *   ◢ drag-region ◣                                                       ◢ no-drag ◣
 *
 * Drag-region is the bar root. Every interactive child has
 * `-webkit-app-region: no-drag` (set in CSS) so clicks on a button never
 * begin a window drag. Window controls are the only OS-aware widgets;
 * everything else is plain JSX.
 *
 * Live status indicators live below in the chat (for streaming) and in
 * the StatusBar (for cost/tokens). The titlebar focuses on:
 *   - Connector pills (replaces the old sidebar ConnectorRail)
 *   - "Ny tråd" + Settings + Theme toggle
 *   - Min / Max / Close
 */

type ConnectorPill = {
  key: ConnectorKey;
  icon: string;
  label: string;
  hasCreds: (s: AppSettings) => boolean;
};

const CONNECTORS: ConnectorPill[] = [
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

export interface TitlebarProps {
  settings: AppSettings;
  onOpenConnectors: (focusKey?: ConnectorKey) => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  themeMode: 'dark' | 'light' | 'solar' | 'cyberpunk' | 'compact';
  /** Optional — opens the keyboard cheatsheet modal. */
  onShowCheatsheet?: () => void;
}

export function Titlebar({
  settings,
  onOpenConnectors,
  onNewThread,
  onOpenSettings,
  onToggleTheme,
  themeMode,
  onShowCheatsheet,
}: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const off = subscribeWindowState(({ maximized: m }) => {
      setMaximized(m);
      // Mirror state to <html> so global CSS can drop outer-radius when
      // maximised (otherwise rounded corners clip oddly at the screen edge).
      const html = document.documentElement;
      if (m) html.setAttribute('data-window-state', 'maximized');
      else html.removeAttribute('data-window-state');
    });
    return () => off();
  }, []);

  return (
    <header className="tb-bar" role="toolbar" aria-label="Window">
      <div className="tb-brand">
        <span className="tb-brand-mark" aria-hidden="true" />
        <span>Nordrise</span>
      </div>

      <div className="tb-pills" role="toolbar" aria-label="Connectors">
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
              className={`tb-pill tb-pill-status-${status}`}
              title={title}
              onClick={() => onOpenConnectors(c.key)}
            >
              <span className="tb-pill-dot" aria-hidden="true" />
              <span className="tb-pill-icon" aria-hidden="true">
                {c.icon}
              </span>
              <span>{c.label}</span>
            </button>
          );
        })}
      </div>

      <div className="tb-spacer" />

      <div className="tb-actions">
        <button
          type="button"
          className="tb-icon-btn"
          data-emphasis="primary"
          onClick={onNewThread}
          title="Ny tråd"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <span>Ny</span>
        </button>
        <button
          type="button"
          className="tb-icon-btn"
          onClick={onToggleTheme}
          title={themeMode === 'dark' ? 'Bytt til lyst' : 'Bytt til mørkt'}
        >
          <span className="tb-icon-btn-glyph" aria-hidden="true">
            {themeMode === 'dark' ? '☀' : '☾'}
          </span>
        </button>
        {onShowCheatsheet && (
          <button
            type="button"
            className="tb-icon-btn"
            onClick={onShowCheatsheet}
            title="Hurtigtaster (?)"
          >
            <span className="tb-icon-btn-glyph" aria-hidden="true">?</span>
          </button>
        )}
        <button
          type="button"
          className="tb-icon-btn"
          onClick={onOpenSettings}
          title="Innstillinger"
        >
          <span className="tb-icon-btn-glyph" aria-hidden="true">⚙</span>
        </button>
      </div>

      <div className="wc-group">
        <button
          type="button"
          className="wc-btn wc-btn-min"
          onClick={() => void minimizeWindow()}
          title="Minimer"
          aria-label="Minimer"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          type="button"
          className="wc-btn wc-btn-max"
          onClick={() => void toggleMaximizeWindow()}
          title={maximized ? 'Gjenopprett' : 'Maksimér'}
          aria-label={maximized ? 'Gjenopprett' : 'Maksimér'}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2 0h8v8h-2M0 2v8h8V2H0z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="wc-btn wc-btn-close"
          onClick={() => void closeWindow()}
          title="Lukk"
          aria-label="Lukk"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>
  );
}
