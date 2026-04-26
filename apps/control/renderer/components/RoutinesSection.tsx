'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  RoutineSummary,
  RoutineCreateInput,
  RoutineChannel,
  ClaudeModelId,
} from '../../src/server-types';
import {
  listRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  runRoutineNow,
} from '../lib/api';
import { explainCron, CRON_PRESETS } from '../lib/cron';

type EditorState =
  | { kind: 'closed' }
  | { kind: 'new' }
  | { kind: 'edit'; routine: RoutineSummary };

const CHANNEL_LABELS: Record<RoutineChannel, string> = {
  desktop: 'Desktop',
  telegram: 'Telegram',
  both: 'Begge',
};

const MODEL_OPTIONS: { value: '' | ClaudeModelId; label: string }[] = [
  { value: '', label: 'Bruk default' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

export function RoutinesSection() {
  const [routines, setRoutines] = useState<RoutineSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listRoutines();
      setRoutines(list);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleToggle(r: RoutineSummary) {
    setBusyId(r.id);
    try {
      await updateRoutine(r.id, { enabled: !r.enabled });
      await refresh();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRunNow(r: RoutineSummary) {
    setBusyId(r.id);
    try {
      await runRoutineNow(r.id);
      // Re-poll soon — the run is async on the backend, the row will land
      // a few seconds later via the recent-runs poll, but bumping the list
      // refresh keeps last-run badges in sync.
      setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(r: RoutineSummary) {
    if (!confirm(`Slette rutinen "${r.name}"?`)) return;
    setBusyId(r.id);
    try {
      await deleteRoutine(r.id);
      await refresh();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusyId(null);
    }
  }

  if (editor.kind !== 'closed') {
    return (
      <RoutineEditor
        initial={editor.kind === 'edit' ? editor.routine : null}
        onCancel={() => setEditor({ kind: 'closed' })}
        onSaved={async () => {
          setEditor({ kind: 'closed' });
          await refresh();
        }}
      />
    );
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Rutiner</h3>
      <p className="settings-section-sub">
        Faste oppgaver Sean utfører på et cron-skjema. Hver kjøring starter
        en frisk samtale, så de er uavhengige av aktive tråder.
      </p>

      <div className="settings-actions-row">
        <button
          type="button"
          className="qt-btn-primary"
          onClick={() => setEditor({ kind: 'new' })}
        >
          + Ny rutine
        </button>
        <button
          type="button"
          className="qt-btn-secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Henter…' : 'Oppdater'}
        </button>
      </div>

      {error && (
        <div className="settings-status settings-status-fail">{error}</div>
      )}

      {!loading && routines.length === 0 && (
        <div className="settings-hint">
          Ingen rutiner enda. Trykk «+ Ny rutine» for å lage en.
        </div>
      )}

      <div className="routines-list">
        {routines.map((r) => (
          <RoutineRow
            key={r.id}
            r={r}
            busy={busyId === r.id}
            onToggle={() => void handleToggle(r)}
            onRun={() => void handleRunNow(r)}
            onEdit={() => setEditor({ kind: 'edit', routine: r })}
            onDelete={() => void handleDelete(r)}
          />
        ))}
      </div>
    </section>
  );
}

interface RowProps {
  r: RoutineSummary;
  busy: boolean;
  onToggle: () => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RoutineRow({ r, busy, onToggle, onRun, onEdit, onDelete }: RowProps) {
  const lastRun = useMemo(() => {
    if (!r.lastRunAt) return 'aldri kjørt';
    return `Sist: ${formatRelative(r.lastRunAt)}`;
  }, [r.lastRunAt]);

  return (
    <div className="routines-row">
      <div className="routines-row-main">
        <div className="routines-row-name">{r.name}</div>
        <div className="routines-row-meta">
          <span className="routines-row-schedule" title={r.schedule}>
            {explainCron(r.schedule)}
          </span>
          <span className="routines-row-channel">
            {CHANNEL_LABELS[r.channel]}
          </span>
          <span className="routines-row-last">{lastRun}</span>
        </div>
      </div>
      <div className="routines-row-actions">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={r.enabled}
            disabled={busy}
            onChange={onToggle}
          />
          <span>{r.enabled ? 'På' : 'Av'}</span>
        </label>
        <button
          type="button"
          className="qt-btn-secondary"
          onClick={onRun}
          disabled={busy}
        >
          Kjør nå
        </button>
        <button
          type="button"
          className="qt-iconbtn"
          onClick={onEdit}
          disabled={busy}
          title="Rediger"
        >
          ✎
        </button>
        <button
          type="button"
          className="qt-iconbtn qt-iconbtn-danger"
          onClick={onDelete}
          disabled={busy}
          title="Slett"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

interface EditorProps {
  initial: RoutineSummary | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

function RoutineEditor({ initial, onCancel, onSaved }: EditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 9 * * *');
  const [channel, setChannel] = useState<RoutineChannel>(
    initial?.channel ?? 'desktop',
  );
  const [model, setModel] = useState<'' | ClaudeModelId>(
    (initial?.model as ClaudeModelId | null) ?? '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !prompt.trim() || !schedule.trim()) {
      setErr('Navn, prompt og schedule er påkrevd.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload: RoutineCreateInput = {
        name: name.trim(),
        prompt,
        schedule: schedule.trim(),
        enabled,
        channel,
        ...(model ? { model } : {}),
      };
      if (initial) {
        await updateRoutine(initial.id, payload);
      } else {
        await createRoutine(payload);
      }
      await onSaved();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">
        {initial ? 'Rediger rutine' : 'Ny rutine'}
      </h3>
      <form onSubmit={handleSave} className="routines-editor">
        <label className="settings-field">
          <span className="settings-field-label">Navn</span>
          <input
            type="text"
            className="settings-field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Morgenbrief"
            required
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Prompt</span>
          <textarea
            className="settings-field-input routines-editor-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Skriv en kort morgenbrief med viktigste oppgaver i dag…"
            rows={6}
            required
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">
            Schedule (cron)
            <span className="routines-editor-hint">
              {' — '}
              {explainCron(schedule)}
            </span>
          </span>
          <input
            type="text"
            className="settings-field-input"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * *"
            required
            spellCheck={false}
          />
        </label>
        <div className="routines-editor-presets">
          {CRON_PRESETS.map((p) => (
            <button
              type="button"
              key={p.value}
              className="qt-btn-secondary routines-editor-preset"
              onClick={() => setSchedule(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="routines-editor-row">
          <fieldset className="settings-field routines-editor-fieldset">
            <legend className="settings-field-label">Kanal</legend>
            <div className="routines-editor-radios">
              {(['desktop', 'telegram', 'both'] as RoutineChannel[]).map((c) => (
                <label key={c} className="routines-editor-radio">
                  <input
                    type="radio"
                    name="channel"
                    checked={channel === c}
                    onChange={() => setChannel(c)}
                  />
                  <span>{CHANNEL_LABELS[c]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="settings-field routines-editor-fieldset">
            <span className="settings-field-label">Modell</span>
            <select
              className="settings-field-input"
              value={model}
              onChange={(e) =>
                setModel(e.target.value as '' | ClaudeModelId)
              }
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>Aktivert</span>
        </label>
        {err && <div className="settings-status settings-status-fail">{err}</div>}
        <div className="routines-editor-actions">
          <button
            type="button"
            className="qt-btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Avbryt
          </button>
          <button
            type="submit"
            className="qt-btn-primary"
            disabled={saving}
          >
            {saving ? 'Lagrer…' : 'Lagre'}
          </button>
        </div>
      </form>
    </section>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'nettopp';
  const min = Math.floor(diffMs / 60_000);
  if (min < 60) return `for ${min}m siden`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `for ${hr}t siden`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `for ${days}d siden`;
  return new Date(iso).toLocaleDateString('nb-NO');
}
