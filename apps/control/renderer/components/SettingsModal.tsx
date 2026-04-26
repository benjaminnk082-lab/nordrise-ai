'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  settingsApi,
  ollamaApi,
  shellApi,
  type AppSettings,
  type DefaultModelChoice,
  type PermissionMode,
  type PermissionSettings,
} from '../lib/settings';
import {
  setStoredToken,
  verifyToken,
  pingHealthz,
  getPendingUpdate,
  clearStoredToken,
  getUpdateStatus,
  getUpdateLog,
  checkForUpdate,
  getClaudeAuthToken,
  setClaudeAuthToken,
  clearClaudeAuthToken,
  testClaudeAuthToken,
  type UpdateStatus,
} from '../lib/bridge';
import { RoutinesSection } from './RoutinesSection';
import { vaultApi, formatRelative, type VaultStatus, type SeanNote } from '../lib/vault';

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

          {/* OBSIDIAN-VAULT */}
          <VaultSection
            enabled={settings.vault.enabled}
            localPath={settings.vault.localPath}
            onChange={(patch) =>
              void updateSettings({
                vault: { ...settings.vault, ...patch },
              })
            }
          />

          <div className="settings-divider" />

          {/* SEAN'S HUKOMMELSE */}
          <MemoryStreamSection />

          <div className="settings-divider" />

          {/* TILLATELSER */}
          <PermissionsSection
            permissions={settings.permissions}
            onChange={(patch) =>
              void updateSettings({
                permissions: { ...settings.permissions, ...patch },
              })
            }
          />

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

          {/* CLAUDE-AUTH — per-user Claude OAuth token */}
          <ClaudeAuthSection />

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

          {/* VERSJON / OPPDATERING */}
          <UpdateSection version={version} />
          <div className="settings-divider" />
          <section className="settings-section">
            <h3 className="settings-section-title">Reset</h3>
            <button type="button" className="qt-btn-secondary" onClick={() => void handleResetAll()}>
              Reset alle innstillinger
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-user Claude OAuth token. When set, /control/message attaches the token
 * to every request and the backend uses it to spawn claude-code (overriding
 * the server's default Max quota). When unset, the server's default token
 * is used. Stored in the OS keychain via the `claude-auth:*` IPC bridge —
 * never written to settings.json.
 */
function ClaudeAuthSection() {
  const [stored, setStored] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'testing' }
    | { kind: 'ok'; msg?: string }
    | { kind: 'error'; msg: string }
  >({ kind: 'idle' });

  // Load the existing token on mount so we can show "satt" / "ikke satt"
  // status without echoing the secret back into the input.
  useEffect(() => {
    void getClaudeAuthToken().then(setStored);
  }, []);

  function explainError(err: string | undefined): string {
    switch (err) {
      case 'wrong_format':
        return 'Tokenet må starte med sk-ant-oat01-.';
      case 'too_short':
        return 'Tokenet ser for kort ut.';
      case 'no_bearer':
        return 'Du er ikke logget inn (mangler Sean-token).';
      default:
        return err ?? 'ukjent feil';
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t) {
      setStatus({ kind: 'error', msg: 'Lim inn et token først.' });
      return;
    }
    setStatus({ kind: 'testing' });
    try {
      const v = await testClaudeAuthToken(t);
      if (!v.ok) {
        setStatus({ kind: 'error', msg: explainError(v.error) });
        return;
      }
      setStatus({ kind: 'saving' });
      await setClaudeAuthToken(t);
      setStored(t);
      setInput('');
      setStatus({ kind: 'ok', msg: 'Token lagret.' });
    } catch (err) {
      setStatus({ kind: 'error', msg: String((err as Error).message) });
    }
  }

  async function clearStored() {
    if (!confirm('Fjerne din egen Claude-token? Server-default brukes igjen.')) return;
    await clearClaudeAuthToken();
    setStored(null);
    setStatus({ kind: 'ok', msg: 'Token fjernet — bruker server-default.' });
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Claude-auth</h3>
      <p className="settings-section-sub">
        Egen Claude OAuth-token. Når satt, brenner samtaler din egen
        Max-kvote (ikke Benjamins). Hvis ikke satt, faller server tilbake
        til standard-token.
      </p>
      <p className="settings-section-sub">
        Generer ved å kjøre <code>claude setup-token</code> i terminalen din,
        så lim inn her. Token starter med <code>sk-ant-oat01-</code>.
      </p>

      <div
        className={`settings-status settings-status-${stored ? 'ok' : 'idle'}`}
        style={{ marginBottom: 10 }}
      >
        {stored ? '✓ Egen token aktiv' : 'Ingen token — bruker server-default'}
      </div>

      <form onSubmit={save} className="settings-token-form">
        <div className="settings-key-row">
          <input
            type={show ? 'text' : 'password'}
            className="settings-field-input"
            placeholder="sk-ant-oat01-…"
            value={input}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setInput(e.target.value);
              if (status.kind !== 'idle') setStatus({ kind: 'idle' });
            }}
          />
          <button
            type="button"
            className="settings-key-toggle"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Skjul token' : 'Vis token'}
          >
            {show ? 'Skjul' : 'Vis'}
          </button>
          <button
            type="submit"
            className="qt-btn-primary"
            disabled={status.kind === 'testing' || status.kind === 'saving' || !input.trim()}
          >
            {status.kind === 'testing'
              ? 'Tester…'
              : status.kind === 'saving'
                ? 'Lagrer…'
                : 'Lagre'}
          </button>
        </div>
      </form>

      {status.kind === 'error' && (
        <div className="settings-status settings-status-fail" style={{ marginTop: 8 }}>
          {status.msg}
        </div>
      )}
      {status.kind === 'ok' && status.msg && (
        <div className="settings-status settings-status-ok" style={{ marginTop: 8 }}>
          ✓ {status.msg}
        </div>
      )}

      {stored && (
        <button
          type="button"
          className="qt-btn-secondary settings-logout-btn"
          onClick={() => void clearStored()}
        >
          Logg ut Claude
        </button>
      )}
    </section>
  );
}

function UpdateSection({ version }: { version: string }) {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getUpdateStatus().then(setStatus);
    const off = window.nordrise.on('app:update-status', (s: any) => setStatus(s as UpdateStatus));
    const t = setInterval(() => void getUpdateStatus().then(setStatus), 5000);
    return () => { off(); clearInterval(t); };
  }, []);

  async function manualCheck() {
    setBusy(true);
    try {
      const next = await checkForUpdate();
      setStatus(next);
      setLog(await getUpdateLog());
      setShowLog(true);
    } finally { setBusy(false); }
  }

  async function refreshLog() {
    setLog(await getUpdateLog());
    setShowLog(true);
  }

  const label = formatStatus(status);
  const tone = statusTone(status);

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Versjon &amp; oppdatering</h3>
      <div className="settings-version-row">
        <span className="settings-version-num">v{version || '?'}</span>
        <span className={`settings-version-status ${tone}`}>{label}</span>
      </div>
      {status.kind === 'downloading' && (
        <div style={{ marginTop: 6 }}>
          <div style={{
            height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(status.percent)}%`, height: '100%',
              background: 'linear-gradient(90deg, #a78bff, #7c5cff)', transition: 'width 200ms ease',
            }} />
          </div>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="field-error" style={{ marginTop: 8 }}>{status.message}</div>
      )}
      <div className="settings-actions-row" style={{ marginTop: 12 }}>
        <button type="button" className="qt-btn-secondary" disabled={busy || status.kind === 'checking' || status.kind === 'downloading'} onClick={() => void manualCheck()}>
          {busy ? 'Sjekker…' : 'Sjekk for oppdatering'}
        </button>
        <button type="button" className="qt-btn-secondary" onClick={() => void refreshLog()}>
          {showLog ? 'Oppdater logg' : 'Vis logg'}
        </button>
      </div>
      {showLog && (
        <pre style={{
          marginTop: 10, padding: 12, borderRadius: 10,
          background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)',
          fontSize: 11, lineHeight: 1.5, color: 'rgba(244,244,247,0.7)',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap',
        }}>
          {log.length === 0 ? '(tom logg — sjekk for oppdatering først)' : log.join('\n')}
        </pre>
      )}
    </section>
  );
}

function formatStatus(s: UpdateStatus): string {
  switch (s.kind) {
    case 'idle': return 'klar';
    case 'checking': return 'sjekker…';
    case 'up-to-date': return 'opp-til-dato';
    case 'available': return `versjon ${s.version} tilgjengelig — laster ned`;
    case 'downloading': return `laster ned ${Math.round(s.percent)}%`;
    case 'downloaded': return `versjon ${s.version} klar — relaunch for å installere`;
    case 'error': return `feil: ${s.message}`;
    case 'disabled-dev': return 'deaktivert (dev-modus)';
  }
}

function statusTone(s: UpdateStatus): string {
  if (s.kind === 'error') return 'tone-danger';
  if (s.kind === 'downloaded' || s.kind === 'available') return 'tone-accent';
  if (s.kind === 'downloading' || s.kind === 'checking') return 'tone-warn';
  return '';
}

interface VaultSectionProps {
  enabled: boolean;
  localPath: string;
  onChange: (patch: { enabled?: boolean; localPath?: string }) => void;
}

function VaultSection({ enabled, localPath, onChange }: VaultSectionProps) {
  const [status, setStatus] = useState<VaultStatus>({
    enabled: false,
    lastSyncAt: 0,
    fileCount: 0,
    pending: 0,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void vaultApi.status().then(setStatus);
    const off = window.nordrise.on('vault:status', (s: unknown) => {
      setStatus(s as VaultStatus);
    });
    const t = setInterval(() => void vaultApi.status().then(setStatus), 5000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  async function pickFolder() {
    const p = await vaultApi.pickFolder();
    if (p) onChange({ localPath: p });
  }

  async function toggleEnabled(v: boolean) {
    setBusy(true);
    try {
      onChange({ enabled: v });
      if (v) {
        if (!localPath) {
          // refuse to start without a path; flip the toggle back next render
          // when settings re-arrive.
          onChange({ enabled: false });
          return;
        }
        await vaultApi.start(localPath);
      } else {
        await vaultApi.stop();
      }
    } finally {
      setBusy(false);
    }
  }

  async function resyncNow() {
    if (!localPath) return;
    setBusy(true);
    try {
      await vaultApi.resync(localPath);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Obsidian-vault</h3>
      <p className="settings-section-sub">
        Sync av lokal Obsidian-vault til Sean. Sean leser den som kontekst,
        men kan ikke skrive direkte tilbake. Forslag fra Sean dukker opp i
        "Sean&apos;s notater"-panelet i hovedvinduet, hvor du kan godkjenne
        med ett klikk.
      </p>

      <div className="settings-row">
        <label className="settings-field" style={{ flex: 1 }}>
          <span className="settings-field-label">Mappe på PC</span>
          <input
            type="text"
            className="settings-field-input"
            value={localPath}
            spellCheck={false}
            placeholder="C:\Users\…\Documents\ObsidianVault"
            onChange={(e) => onChange({ localPath: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="qt-btn-secondary"
          onClick={() => void pickFolder()}
        >
          Velg…
        </button>
      </div>

      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !localPath}
          onChange={(e) => void toggleEnabled(e.target.checked)}
        />
        <span>Aktivér sync</span>
      </label>

      <div
        className={`settings-status settings-status-${
          status.error ? 'fail' : status.enabled ? 'ok' : 'idle'
        }`}
      >
        {status.error
          ? `✗ ${status.error}`
          : status.enabled
            ? `✓ ${status.fileCount} fil${status.fileCount === 1 ? '' : 'er'}` +
              ` · sist synket ${formatRelative(status.lastSyncAt)}` +
              (status.pending > 0 ? ` · ${status.pending} venter` : '')
            : 'Inaktiv'}
      </div>

      <div className="settings-actions-row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="qt-btn-secondary"
          disabled={busy || !enabled || !localPath}
          onClick={() => void resyncNow()}
        >
          {busy ? 'Synker…' : 'Resync nå'}
        </button>
      </div>
    </section>
  );
}

interface PermissionRow {
  key: keyof PermissionSettings;
  label: string;
  desc: string;
}

const PERMISSION_ROWS: PermissionRow[] = [
  {
    key: 'vaultWrite',
    label: 'Skrive til Obsidian-vault',
    desc: 'Sean’s notater kopieres automatisk inn i vaulten.',
  },
  {
    key: 'telegramSend',
    label: 'Sende Telegram-meldinger',
    desc: 'Routine-notifikasjoner og proaktive meldinger.',
  },
  {
    key: 'webSearch',
    label: 'Web-søk',
    desc: 'Bruk Firecrawl uten å spørre.',
  },
  {
    key: 'githubAccess',
    label: 'GitHub-tilgang',
    desc: 'Lese repos / issues / PRs uten å spørre.',
  },
  {
    key: 'shellExec',
    label: 'Shell-kommandoer',
    desc: 'Kjøre systemkommandoer (kommer i v0.2.4).',
  },
];

const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'ask', label: 'Spør' },
  { value: 'block', label: 'Blokker' },
];

interface PermissionsSectionProps {
  permissions: PermissionSettings;
  onChange: (patch: Partial<PermissionSettings>) => void;
}

function PermissionsSection({ permissions, onChange }: PermissionsSectionProps) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Tillatelser</h3>
      <p className="settings-section-sub">
        Hvor proaktiv Sean får være. <strong>Auto</strong> kjører
        uten å spørre, <strong>Spør</strong> ber om bekreftelse,{' '}
        <strong>Blokker</strong> nekter handlingen helt. Bare vault-skriving
        er håndhevet i v0.2.3 — resten lagres som hensikt og kobles
        på backenden i v0.2.4.
      </p>
      {PERMISSION_ROWS.map((row) => (
        <div key={row.key} className="perm-row">
          <div>
            <div className="perm-label">{row.label}</div>
            <div className="perm-desc">{row.desc}</div>
          </div>
          <div className="perm-segment" role="radiogroup" aria-label={row.label}>
            {PERMISSION_MODES.map((m) => {
              const active = permissions[row.key] === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={
                    'perm-segment-btn' +
                    (active ? ' perm-segment-btn-active' : '')
                  }
                  onClick={() => onChange({ [row.key]: m.value } as Partial<PermissionSettings>)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

type MemoryTab = 'learnings' | 'journal';

/**
 * Surfaces files Sean has written under `sean-notes/learnings/` and
 * `sean-notes/journal/`. Read-only by design — the source of truth is the
 * server's filesystem; this is just a window into what Sean has remembered.
 * Tap a row to expand its full content; "Avvis" removes it (delegated to
 * the existing dismiss-note IPC).
 */
function MemoryStreamSection() {
  const [tab, setTab] = useState<MemoryTab>('learnings');
  const [notes, setNotes] = useState<SeanNote[]>([]);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await vaultApi.listMemoryNotes(tab);
      setNotes(list);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.path.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }, [notes, filter]);

  async function dismiss(path: string) {
    setBusyPath(path);
    try {
      await vaultApi.dismissNote(path);
      await refresh();
      if (expanded === path) setExpanded(null);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Sean&apos;s hukommelse</h3>
      <p className="settings-section-sub">
        Hva Sean har lagret i <code>sean-notes/learnings/</code> og{' '}
        <code>sean-notes/journal/</code> over tid. Alfabetisk{' '}
        søkbart — bruk det til å se hvilke mønstre Sean har plukket opp.
      </p>

      <div
        className="perm-segment"
        role="radiogroup"
        aria-label="Hukommelse-fane"
        style={{ marginBottom: 10 }}
      >
        {(['learnings', 'journal'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tab === t}
            className={
              'perm-segment-btn' +
              (tab === t ? ' perm-segment-btn-active' : '')
            }
            onClick={() => {
              setTab(t);
              setExpanded(null);
            }}
          >
            {t === 'learnings' ? 'Lærdommer' : 'Journal'}
          </button>
        ))}
      </div>

      <input
        type="text"
        className="settings-field-input"
        placeholder={`Søk i ${tab === 'learnings' ? 'lærdommer' : 'journal'}…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        spellCheck={false}
      />

      {error && (
        <div className="settings-status settings-status-fail" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {loading && notes.length === 0 && (
        <div className="settings-status settings-status-idle" style={{ marginTop: 10 }}>
          Laster…
        </div>
      )}
      {!loading && notes.length === 0 && (
        <div className="settings-status settings-status-idle" style={{ marginTop: 10 }}>
          Ingenting i {tab === 'learnings' ? 'lærdommer' : 'journal'} ennå.
        </div>
      )}
      {!loading && notes.length > 0 && filtered.length === 0 && (
        <div className="settings-status settings-status-idle" style={{ marginTop: 10 }}>
          Ingen treff på "{filter}".
        </div>
      )}

      <div
        className="memory-stream-list"
        style={{
          marginTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          maxHeight: 360,
          overflow: 'auto',
        }}
      >
        {filtered.map((note) => {
          const isOpen = expanded === note.path;
          const preview = note.content
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
          const fileName = note.path.split('/').pop() ?? note.path;
          return (
            <div
              key={note.path}
              className="memory-stream-row"
              style={{
                padding: 10,
                borderRadius: 10,
                background: 'rgba(0,0,0,0.32)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : note.path)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
                aria-expanded={isOpen}
              >
                <header
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 4,
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: 12,
                      color: 'rgba(244,244,247,0.85)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fileName}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgba(244,244,247,0.5)',
                      flexShrink: 0,
                    }}
                  >
                    {formatRelative(note.mtime)}
                  </span>
                </header>
                {!isOpen && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'rgba(244,244,247,0.65)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {preview}
                    {note.content.length > 100 && '…'}
                  </p>
                )}
              </button>
              {isOpen && (
                <>
                  <pre
                    style={{
                      margin: '8px 0 0',
                      padding: 8,
                      borderRadius: 6,
                      background: 'rgba(0,0,0,0.45)',
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: 'rgba(244,244,247,0.78)',
                      maxHeight: 240,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {note.content}
                  </pre>
                  <div className="settings-actions-row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="qt-btn-secondary"
                      disabled={busyPath === note.path}
                      onClick={() => void dismiss(note.path)}
                    >
                      {busyPath === note.path ? 'Sletter…' : 'Slett'}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
