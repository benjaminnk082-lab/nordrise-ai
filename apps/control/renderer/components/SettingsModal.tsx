'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  settingsApi,
  ollamaApi,
  shellApi,
  type AppSettings,
  type DefaultModelChoice,
} from '../lib/settings';
import {
  setStoredToken,
  verifyToken,
  pingHealthz,
  getPendingUpdate,
  clearStoredToken,
} from '../lib/bridge';
import { RoutinesSection } from './RoutinesSection';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
  version: string;
  onLogout: () => void | Promise<void>;
}

interface OllamaProbe {
  status: 'idle' | 'checking' | 'ok' | 'fail';
  version?: string;
  error?: string;
  models: string[];
}

interface UsageProbe {
  loading: boolean;
  recent: number | null;
}

const MODEL_OPTIONS: { value: DefaultModelChoice; label: string; sub: string }[] = [
  { value: 'auto', label: 'Auto', sub: 'Velg etter heuristikk' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7', sub: 'Best, dyrest' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6', sub: 'Balansert' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5', sub: 'Raskest, billigst' },
];

export function SettingsModal({
  open,
  onClose,
  settings,
  onSettingsChange,
  version,
  onLogout,
}: SettingsModalProps) {
  const [probe, setProbe] = useState<OllamaProbe>({ status: 'idle', models: [] });
  const [usage, setUsage] = useState<UsageProbe>({ loading: false, recent: null });
  const [tokenInput, setTokenInput] = useState('');
  const [tokenStatus, setTokenStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'error'; msg: string }
    | { kind: 'ok' }
  >({ kind: 'idle' });
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [showFirecrawlKey, setShowFirecrawlKey] = useState(false);
  const [showGithubKey, setShowGithubKey] = useState(false);
  const [savedToast, setSavedToast] = useState<null | 'firecrawl' | 'github'>(null);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = await settingsApi.set(patch);
      onSettingsChange(next);
    },
    [onSettingsChange],
  );

  const probeOllama = useCallback(async (host: string) => {
    setProbe({ status: 'checking', models: [] });
    const det = await ollamaApi.detect(host);
    if (!det.ok) {
      setProbe({ status: 'fail', ...(det.error ? { error: det.error } : {}), models: [] });
      return;
    }
    const models = await ollamaApi.listModels(host);
    const next: OllamaProbe = { status: 'ok', models };
    if (det.version !== undefined) next.version = det.version;
    setProbe(next);
  }, []);

  // Initial fetch when opened.
  useEffect(() => {
    if (!open) return;
    void getPendingUpdate().then(setPendingVersion);
    setUsage({ loading: true, recent: null });
    void pingHealthz().then((r) => {
      const body = r.body as { recentMessageCount?: number | null } | null;
      const recent = typeof body?.recentMessageCount === 'number'
        ? body.recentMessageCount
        : null;
      setUsage({ loading: false, recent });
    });
    if (settings.ollamaEnabled) {
      void probeOllama(settings.ollamaHost);
    }
  }, [open, settings.ollamaEnabled, settings.ollamaHost, probeOllama]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const ollamaDisabled = !settings.ollamaEnabled || probe.status !== 'ok';
  const statusLabel = useMemo(() => {
    if (!settings.ollamaEnabled) return 'Av';
    if (probe.status === 'idle') return 'Ikke testet';
    if (probe.status === 'checking') return 'Kobler til…';
    if (probe.status === 'ok') return `Detektert${probe.version ? ` v${probe.version}` : ''}`;
    return 'Ikke kjørende';
  }, [settings.ollamaEnabled, probe]);

  async function saveToken(e: React.FormEvent) {
    e.preventDefault();
    const t = tokenInput.trim();
    if (t.length < 32) {
      setTokenStatus({ kind: 'error', msg: 'Tokenet må være minst 32 tegn.' });
      return;
    }
    setTokenStatus({ kind: 'saving' });
    try {
      const v = await verifyToken(t);
      if (v.status === 401 || v.status === 403) {
        setTokenStatus({ kind: 'error', msg: 'Tokenet ble ikke godkjent av Sean.' });
        return;
      }
      await setStoredToken(t);
      setTokenInput('');
      setTokenStatus({ kind: 'ok' });
    } catch (err) {
      setTokenStatus({ kind: 'error', msg: String((err as Error).message) });
    }
  }

  async function handleResetAll() {
    if (!confirm('Tilbakestille alle innstillinger? (token beholdes)')) return;
    const next = await settingsApi.reset();
    onSettingsChange(next);
    setProbe({ status: 'idle', models: [] });
  }

  async function handleLogoutClick() {
    if (!confirm('Logge ut og fjerne tokenet?')) return;
    await clearStoredToken();
    await onLogout();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-modal settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qt-modal-head">
          <span className="qt-manager-title">Innstillinger</span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onClose}
            aria-label="Lukk"
          >
            ×
          </button>
        </div>

        <div className="settings-body">
          {/* MODELL */}
          <section className="settings-section">
            <h3 className="settings-section-title">Modell</h3>
            <p className="settings-section-sub">
              Velg standard. <strong>Auto</strong> ruter enkle meldinger til
              Haiku, kompliserte til Opus, alt midt-på til Sonnet.
            </p>
            <div className="settings-radio-grid">
              {MODEL_OPTIONS.map((m) => {
                const selected = settings.defaultModel === m.value;
                return (
                  <button
                    type="button"
                    key={m.value}
                    className={`settings-radio ${selected ? 'settings-radio-active' : ''}`}
                    onClick={() => void updateSettings({ defaultModel: m.value })}
                  >
                    <span className="settings-radio-label">{m.label}</span>
                    <span className="settings-radio-sub">{m.sub}</span>
                  </button>
                );
              })}
            </div>
            <label className={`settings-toggle ${ollamaDisabled ? 'settings-toggle-disabled' : ''}`}>
              <input
                type="checkbox"
                checked={settings.preferOllamaForSimple}
                disabled={ollamaDisabled}
                onChange={(e) =>
                  void updateSettings({ preferOllamaForSimple: e.target.checked })
                }
              />
              <span>Foretrekk Ollama for enkle tasks</span>
            </label>
          </section>

          <div className="settings-divider" />

          {/* OLLAMA */}
          <section className="settings-section">
            <h3 className="settings-section-title">Ollama (lokal)</h3>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.ollamaEnabled}
                onChange={(e) =>
                  void updateSettings({ ollamaEnabled: e.target.checked })
                }
              />
              <span>Aktiver Ollama-integrasjon</span>
            </label>
            <div className="settings-row">
              <label className="settings-field">
                <span className="settings-field-label">Host</span>
                <input
                  type="text"
                  className="settings-field-input"
                  value={settings.ollamaHost}
                  disabled={!settings.ollamaEnabled}
                  onChange={(e) =>
                    void updateSettings({ ollamaHost: e.target.value })
                  }
                  placeholder="http://localhost:11434"
                />
              </label>
              <button
                type="button"
                className="qt-btn-secondary"
                disabled={!settings.ollamaEnabled || probe.status === 'checking'}
                onClick={() => void probeOllama(settings.ollamaHost)}
              >
                {probe.status === 'checking' ? 'Tester…' : 'Test'}
              </button>
            </div>
            <div className={`settings-status settings-status-${probe.status === 'ok' ? 'ok' : probe.status === 'fail' ? 'fail' : 'idle'}`}>
              {probe.status === 'ok' && '✓ '}
              {probe.status === 'fail' && '✗ '}
              {statusLabel}
              {probe.status === 'fail' && probe.error && (
                <span className="settings-status-detail"> — {probe.error}</span>
              )}
            </div>
            {probe.status === 'ok' && probe.models.length > 0 && (
              <label className="settings-field">
                <span className="settings-field-label">Modell</span>
                <select
                  className="settings-field-input"
                  value={settings.ollamaModel}
                  onChange={(e) =>
                    void updateSettings({ ollamaModel: e.target.value })
                  }
                >
                  <option value="">— Velg modell —</option>
                  {probe.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {probe.status === 'ok' && probe.models.length === 0 && (
              <div className="settings-hint">
                Ingen modeller funnet. Installer en med <code>ollama pull qwen2.5-coder:14b</code> el.l.
              </div>
            )}
          </section>

          <div className="settings-divider" />

          {/* CONNECTORS — MCP-baserte verktøy som Sean kan bruke */}
          <section className="settings-section">
            <h3 className="settings-section-title">Connectors</h3>
            <p className="settings-section-sub">
              MCP-verktøy Sean kan bruke når du skriver til ham. Nøklene
              lagres lokalt på denne maskinen og sendes med hver melding.
              De lagres aldri på serveren.
            </p>

            {/* Firecrawl */}
            <div className="settings-connector-card">
              <div className="settings-connector-head">
                <span className="settings-connector-name">🌐 Firecrawl</span>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.connectors.firecrawl.enabled}
                    onChange={(e) =>
                      void updateSettings({
                        connectors: {
                          ...settings.connectors,
                          firecrawl: {
                            ...settings.connectors.firecrawl,
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                  />
                  <span>Aktiv</span>
                </label>
              </div>
              <p className="settings-connector-desc">
                Hent og søk på nettet. Trenger API-key fra firecrawl.dev
                (gratis tier holder).
              </p>
              <div
                className={`settings-key-row ${
                  !settings.connectors.firecrawl.enabled
                    ? 'settings-key-row-disabled'
                    : ''
                }`}
              >
                <input
                  type={showFirecrawlKey ? 'text' : 'password'}
                  className="settings-field-input"
                  placeholder="fc-…"
                  value={settings.connectors.firecrawl.apiKey}
                  disabled={!settings.connectors.firecrawl.enabled}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) =>
                    void updateSettings({
                      connectors: {
                        ...settings.connectors,
                        firecrawl: {
                          ...settings.connectors.firecrawl,
                          apiKey: e.target.value,
                        },
                      },
                    })
                  }
                />
                <button
                  type="button"
                  className="settings-key-toggle"
                  onClick={() => setShowFirecrawlKey((v) => !v)}
                  disabled={!settings.connectors.firecrawl.enabled}
                  aria-label={showFirecrawlKey ? 'Skjul nøkkel' : 'Vis nøkkel'}
                >
                  {showFirecrawlKey ? 'Skjul' : 'Vis'}
                </button>
                <button
                  type="button"
                  className="qt-btn-secondary"
                  disabled={
                    !settings.connectors.firecrawl.enabled ||
                    !settings.connectors.firecrawl.apiKey.trim()
                  }
                  onClick={() => {
                    setSavedToast('firecrawl');
                    setTimeout(
                      () =>
                        setSavedToast((t) => (t === 'firecrawl' ? null : t)),
                      1800,
                    );
                  }}
                >
                  Test
                </button>
              </div>
              {savedToast === 'firecrawl' && (
                <span className="settings-toast">
                  ✓ Lagret. Faktisk test skjer når Sean prøver å bruke
                  connectoren.
                </span>
              )}
              <button
                type="button"
                className="settings-help-link"
                onClick={() =>
                  void shellApi.openExternal('https://www.firecrawl.dev/app/api-keys')
                }
              >
                ℹ Hjelp — hvor får jeg API-key?
              </button>
            </div>

            {/* GitHub */}
            <div className="settings-connector-card">
              <div className="settings-connector-head">
                <span className="settings-connector-name">🐙 GitHub</span>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={settings.connectors.github.enabled}
                    onChange={(e) =>
                      void updateSettings({
                        connectors: {
                          ...settings.connectors,
                          github: {
                            ...settings.connectors.github,
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                  />
                  <span>Aktiv</span>
                </label>
              </div>
              <p className="settings-connector-desc">
                Les issues, PRs, kode. Trenger Personal Access Token med
                repo-scope.
              </p>
              <div
                className={`settings-key-row ${
                  !settings.connectors.github.enabled
                    ? 'settings-key-row-disabled'
                    : ''
                }`}
              >
                <input
                  type={showGithubKey ? 'text' : 'password'}
                  className="settings-field-input"
                  placeholder="ghp_…"
                  value={settings.connectors.github.token}
                  disabled={!settings.connectors.github.enabled}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) =>
                    void updateSettings({
                      connectors: {
                        ...settings.connectors,
                        github: {
                          ...settings.connectors.github,
                          token: e.target.value,
                        },
                      },
                    })
                  }
                />
                <button
                  type="button"
                  className="settings-key-toggle"
                  onClick={() => setShowGithubKey((v) => !v)}
                  disabled={!settings.connectors.github.enabled}
                  aria-label={showGithubKey ? 'Skjul token' : 'Vis token'}
                >
                  {showGithubKey ? 'Skjul' : 'Vis'}
                </button>
                <button
                  type="button"
                  className="qt-btn-secondary"
                  disabled={
                    !settings.connectors.github.enabled ||
                    !settings.connectors.github.token.trim()
                  }
                  onClick={() => {
                    setSavedToast('github');
                    setTimeout(
                      () =>
                        setSavedToast((t) => (t === 'github' ? null : t)),
                      1800,
                    );
                  }}
                >
                  Test
                </button>
              </div>
              {savedToast === 'github' && (
                <span className="settings-toast">
                  ✓ Lagret. Faktisk test skjer når Sean prøver å bruke
                  connectoren.
                </span>
              )}
              <button
                type="button"
                className="settings-help-link"
                onClick={() =>
                  void shellApi.openExternal(
                    'https://github.com/settings/tokens/new?scopes=repo&description=Nordrise%20Control',
                  )
                }
              >
                ℹ Hjelp — opprett en PAT
              </button>
            </div>
          </section>

          <div className="settings-divider" />

          {/* RUTINER */}
          <RoutinesSection />

          <div className="settings-divider" />

          {/* BRUK */}
          <section className="settings-section">
            <h3 className="settings-section-title">Bruk siste 5 timer</h3>
            <div className="settings-usage">
              {usage.loading ? (
                <span className="settings-usage-num">…</span>
              ) : usage.recent === null ? (
                <span className="settings-usage-num">?</span>
              ) : (
                <span className="settings-usage-num">{usage.recent}</span>
              )}
              <span className="settings-usage-label">meldinger</span>
            </div>
            <p className="settings-section-sub">
              Max-kvoten din nullstilles hver 5. time. Tallet teller alle meldinger
              i Sean-databasen, ikke kun fra denne maskinen.
            </p>
          </section>

          <div className="settings-divider" />

          {/* TOKEN */}
          <section className="settings-section">
            <h3 className="settings-section-title">Token</h3>
            <form onSubmit={saveToken} className="settings-token-form">
              <input
                type="password"
                className="settings-field-input"
                placeholder="Lim inn nytt token (64-tegns hex)"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  if (tokenStatus.kind !== 'idle') setTokenStatus({ kind: 'idle' });
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="submit"
                className="qt-btn-primary"
                disabled={tokenStatus.kind === 'saving' || tokenInput.trim().length < 8}
              >
                {tokenStatus.kind === 'saving' ? 'Lagrer…' : 'Endre token'}
              </button>
            </form>
            {tokenStatus.kind === 'error' && (
              <div className="settings-status settings-status-fail">
                {tokenStatus.msg}
              </div>
            )}
            {tokenStatus.kind === 'ok' && (
              <div className="settings-status settings-status-ok">
                ✓ Token oppdatert
              </div>
            )}
            <button
              type="button"
              className="qt-btn-secondary settings-logout-btn"
              onClick={() => void handleLogoutClick()}
            >
              Logg ut
            </button>
          </section>

          <div className="settings-divider" />

          {/* HOTKEYS */}
          <section className="settings-section">
            <h3 className="settings-section-title">Hurtigtaster</h3>
            <ul className="settings-hotkeys">
              <li>
                <kbd>Ctrl</kbd>+<kbd>K</kbd>
                <span>Quick-task palette</span>
              </li>
              <li>
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>
                <span>Mini-popup</span>
              </li>
              <li>
                <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
                <span>Fokus hovedvindu</span>
              </li>
              <li>
                <kbd>Esc</kbd>
                <span>Avbryt streaming / lukk modal</span>
              </li>
            </ul>
          </section>

          <div className="settings-divider" />

          {/* VERSJON */}
          <section className="settings-section">
            <h3 className="settings-section-title">Versjon</h3>
            <div className="settings-version-row">
              <span className="settings-version-num">v{version || '?'}</span>
              {pendingVersion ? (
                <span className="settings-version-pending">
                  oppdatering {pendingVersion} klar — relaunch for å installere
                </span>
              ) : (
                <span className="settings-version-status">opp-til-dato</span>
              )}
            </div>
            <div className="settings-actions-row">
              <button
                type="button"
                className="qt-btn-secondary"
                onClick={() =>
                  void getPendingUpdate().then((v) => setPendingVersion(v))
                }
              >
                Sjekk for oppdatering
              </button>
              <button
                type="button"
                className="qt-btn-secondary"
                onClick={() => void handleResetAll()}
              >
                Reset alle innstillinger
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
