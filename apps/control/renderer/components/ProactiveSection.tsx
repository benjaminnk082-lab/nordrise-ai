'use client';
import { useCallback, useEffect, useState } from 'react';
import type {
  ProactiveSettingsRow,
  ProactiveAttemptRow,
} from '../../src/server-types';
import { proactiveApi, type ProactiveSettingsPatch } from '../lib/proactive';

/**
 * Settings UI for the proactive engine. Read-write for the singleton settings
 * row; read-only for the attempts log (last 100). "Generer nå" hits run-now
 * and refreshes both panels.
 */
export function ProactiveSection() {
  const [settings, setSettings] = useState<ProactiveSettingsRow | null>(null);
  const [attempts, setAttempts] = useState<ProactiveAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        proactiveApi.getSettings(),
        proactiveApi.attempts(),
      ]);
      setSettings(s);
      setAttempts(a.attempts ?? []);
      setError(null);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback(
    async (p: ProactiveSettingsPatch) => {
      if (!settings) return;
      // Optimistic — flip locally so toggles feel instant. If the PATCH
      // fails we'll re-pull on next refresh.
      setSettings({ ...settings, ...p });
      try {
        const next = await proactiveApi.setSettings(p);
        setSettings(next);
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 1500);
      } catch (e) {
        setError(String((e as Error).message));
        void refresh();
      }
    },
    [settings, refresh],
  );

  async function runNow() {
    setRunning(true);
    setRunMsg(null);
    try {
      const r = await proactiveApi.runNow();
      setRunMsg(`Resultat: ${String(r.decision)}`);
      // Give the engine a beat to write its row before we fetch again.
      setTimeout(() => void refresh(), 800);
    } catch (e) {
      setRunMsg('Feil: ' + String((e as Error).message));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Proaktiv Sean</h3>
      <p className="settings-section-sub">
        Sean melder seg uoppfordret med spørsmål, status, ideer eller
        observasjoner. Stille tider, rate limits og en "skip"-default holder
        ham fra å spamme.
      </p>

      {loading && (
        <div className="settings-status settings-status-idle">Laster…</div>
      )}
      {error && !loading && (
        <div className="settings-status settings-status-fail">{error}</div>
      )}

      {settings && (
        <>
          <label
            className={
              'settings-toggle' +
              (!settings.enabled ? ' settings-toggle-disabled-soft' : '')
            }
          >
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => void patch({ enabled: e.target.checked })}
            />
            <span>Aktiver proaktiv-modus</span>
          </label>

          <div
            className={`proactive-grid ${!settings.enabled ? 'proactive-grid-dim' : ''}`}
          >
            <label className="settings-field">
              <span className="settings-field-label">Stille fra (time)</span>
              <select
                className="settings-field-input"
                value={settings.quietHourStart}
                disabled={!settings.enabled}
                onChange={(e) =>
                  void patch({ quietHourStart: Number(e.target.value) })
                }
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Stille til (time)</span>
              <select
                className="settings-field-input"
                value={settings.quietHourEnd}
                disabled={!settings.enabled}
                onChange={(e) =>
                  void patch({ quietHourEnd: Number(e.target.value) })
                }
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Maks per time</span>
              <input
                type="number"
                className="settings-field-input"
                min={0}
                max={20}
                value={settings.maxPerHour}
                disabled={!settings.enabled}
                onChange={(e) =>
                  void patch({ maxPerHour: Number(e.target.value) })
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Maks per dag</span>
              <input
                type="number"
                className="settings-field-input"
                min={0}
                max={50}
                value={settings.maxPerDay}
                disabled={!settings.enabled}
                onChange={(e) =>
                  void patch({ maxPerDay: Number(e.target.value) })
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Cadence (min)</span>
              <input
                type="number"
                className="settings-field-input"
                min={5}
                max={120}
                value={settings.cadenceMin}
                disabled={!settings.enabled}
                onChange={(e) =>
                  void patch({ cadenceMin: Number(e.target.value) })
                }
              />
            </label>
          </div>

          <div className="settings-actions-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="qt-btn-primary"
              onClick={() => void runNow()}
              disabled={running}
            >
              {running ? 'Kjører…' : 'Generer nå'}
            </button>
            {runMsg && <span className="settings-toast">{runMsg}</span>}
            {savedToast && !runMsg && (
              <span className="settings-toast">✓ Lagret</span>
            )}
          </div>

          <div className="proactive-attempts">
            <div className="proactive-attempts-head">
              Siste forsøk ({attempts.length})
            </div>
            {attempts.length === 0 && (
              <div className="settings-status settings-status-idle">
                Ingen forsøk loggført ennå.
              </div>
            )}
            <ul className="proactive-attempts-list">
              {attempts.slice(0, 30).map((a) => (
                <li
                  key={a.id}
                  className={`proactive-attempt proactive-attempt-${
                    a.decision === 'sent' ? 'sent' : 'skipped'
                  }`}
                  title={a.reason ?? ''}
                >
                  <span className="proactive-attempt-time">
                    {formatTimeShort(a.triggeredAt)}
                  </span>
                  <span className="proactive-attempt-decision">
                    {decisionGlyph(a.decision)} {a.decision}
                  </span>
                  {a.category && (
                    <span className="proactive-attempt-category">
                      {a.category}
                    </span>
                  )}
                  <span className="proactive-attempt-reason">
                    {(a.message ?? a.reason ?? '').slice(0, 90)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function decisionGlyph(d: string): string {
  switch (d) {
    case 'sent':
      return '✓';
    case 'rate_limited':
      return '⊝';
    case 'quiet_hours':
      return '◐';
    case 'disabled':
      return '–';
    default:
      return '·';
  }
}

function formatTimeShort(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const h = String(t.getHours()).padStart(2, '0');
  const m = String(t.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
