'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QuickTask, QuickTaskInput } from '../lib/quickTasks';
import { qt, detectVariables } from '../lib/quickTasks';

export interface QuickTaskManagerProps {
  open: boolean;
  onClose: () => void;
}

type EditorState =
  | { kind: 'closed' }
  | { kind: 'new' }
  | { kind: 'edit'; task: QuickTask };

export function QuickTaskManager({ open, onClose }: QuickTaskManagerProps) {
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await qt.list();
      setTasks(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (editor.kind !== 'closed') setEditor({ kind: 'closed' });
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editor, onClose]);

  if (!open) return null;

  return (
    <div className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-manager"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qt-modal-head">
          <span className="qt-manager-title">Quick-tasks</span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onClose}
            aria-label="Lukk"
          >
            ×
          </button>
        </div>

        {editor.kind === 'closed' ? (
          <>
            <div className="qt-manager-actions">
              <button
                type="button"
                className="qt-btn-primary"
                onClick={() => setEditor({ kind: 'new' })}
              >
                + Ny
              </button>
            </div>
            <div className="qt-manager-list">
              {loading && (
                <div className="qt-manager-empty">Henter…</div>
              )}
              {!loading && tasks.length === 0 && (
                <div className="qt-manager-empty">
                  Ingen quick-tasks ennå. Trykk &laquo;+ Ny&raquo; for å lage en.
                </div>
              )}
              {tasks.map((t) => (
                <div key={t.id} className="qt-manager-row">
                  <span className="qt-manager-emoji">{t.emoji || '⚡'}</span>
                  <div className="qt-manager-rowbody">
                    <div className="qt-manager-rowtitle">{t.title}</div>
                    <div className="qt-manager-rowtemplate">
                      {t.template.split('\n')[0]?.slice(0, 80) ?? ''}
                      {t.template.length > 80 ? '…' : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="qt-iconbtn"
                    onClick={() => setEditor({ kind: 'edit', task: t })}
                    title="Rediger"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="qt-iconbtn qt-iconbtn-danger"
                    onClick={async () => {
                      if (!confirm(`Slette &laquo;${t.title}&raquo;?`)) return;
                      await qt.delete(t.id);
                      void refresh();
                    }}
                    title="Slett"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <QuickTaskEditor
            initial={editor.kind === 'edit' ? editor.task : null}
            onCancel={() => setEditor({ kind: 'closed' })}
            onSaved={async () => {
              setEditor({ kind: 'closed' });
              await refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}

interface EditorProps {
  initial: QuickTask | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

function QuickTaskEditor({ initial, onCancel, onSaved }: EditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '');
  const [template, setTemplate] = useState(initial?.template ?? '');
  const [attachClipboard, setAttachClipboard] = useState(
    initial?.attachClipboard ?? false,
  );
  const [saving, setSaving] = useState(false);

  const detected = useMemo(() => detectVariables(template), [template]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !template.trim()) return;
    setSaving(true);
    try {
      const payload: QuickTaskInput = {
        title: title.trim(),
        emoji: emoji.trim(),
        template,
        attachClipboard,
      };
      if (initial) {
        await qt.update(initial.id, payload);
      } else {
        await qt.create(payload);
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="qt-editor">
      <div className="qt-editor-row">
        <label className="qt-editor-field qt-editor-field-emoji">
          <span className="qt-editor-label">Emoji</span>
          <input
            type="text"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="⚡"
            className="qt-editor-input"
            maxLength={4}
          />
        </label>
        <label className="qt-editor-field qt-editor-field-title">
          <span className="qt-editor-label">Tittel</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Oppsummer e-post"
            className="qt-editor-input"
            required
          />
        </label>
      </div>
      <label className="qt-editor-field">
        <span className="qt-editor-label">Mal</span>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder={'Skriv et utkast for kunde {{kunde}} i periode {{periode}}…'}
          className="qt-editor-textarea"
          rows={5}
          required
        />
      </label>
      {detected.length > 0 && (
        <div className="qt-editor-hint">
          Variabler: {detected.map((v) => `{{${v.name}}}`).join(', ')}
        </div>
      )}
      <label className="qt-editor-checkbox">
        <input
          type="checkbox"
          checked={attachClipboard}
          onChange={(e) => setAttachClipboard(e.target.checked)}
        />
        <span>Legg ved utklippstavlen automatisk</span>
      </label>
      <div className="qt-editor-actions">
        <button
          type="button"
          className="qt-btn-secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Avbryt
        </button>
        <button type="submit" className="qt-btn-primary" disabled={saving}>
          {saving ? 'Lagrer…' : 'Lagre'}
        </button>
      </div>
    </form>
  );
}
