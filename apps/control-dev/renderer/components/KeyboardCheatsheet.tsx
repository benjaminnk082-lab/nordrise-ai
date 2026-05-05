'use client';
import { useEffect } from 'react';

/**
 * KeyboardCheatsheet — modal that lists every keyboard shortcut the
 * desktop client respects, grouped by surface. Triggered from the
 * `?` key (anywhere) or the small `?`-button in the titlebar.
 *
 * Single source of truth for shortcuts so the Settings → Hurtigtaster
 * section can be deprecated later in favour of this richer view.
 */

export interface KeyboardCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  rows: Array<{ keys: string[]; label: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Globalt',
    rows: [
      { keys: ['Ctrl', 'K'], label: 'Universell command palette' },
      { keys: ['Ctrl', 'F'], label: 'Søk i meldinger og vault' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Mini-popup (rask spørsmål)' },
      { keys: ['Ctrl', 'Shift', 'L'], label: 'Fokus hovedvindu' },
      { keys: ['?'], label: 'Vis denne hjelpen' },
    ],
  },
  {
    title: 'Komposisjon',
    rows: [
      { keys: ['Enter'], label: 'Send melding' },
      { keys: ['Shift', 'Enter'], label: 'Ny linje' },
      { keys: ['Esc'], label: 'Avbryt streaming / lukk modal' },
      { keys: ['Tab'], label: 'Auto-komplettering (i quick-task vars)' },
    ],
  },
  {
    title: 'Tråder',
    rows: [
      { keys: ['↑', '↓'], label: 'Naviger tråder i venstre liste' },
      { keys: ['Enter'], label: 'Åpne valgt tråd' },
      { keys: ['F2'], label: 'Endre navn på aktiv tråd' },
    ],
  },
];

export function KeyboardCheatsheet({ open, onClose }: KeyboardCheatsheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hurtigtaster"
      className="qt-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="qt-palette kb-cheatsheet"
        style={{ width: 'min(620px, 92vw)', padding: 'var(--space-5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 'var(--space-4)',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>
            Hurtigtaster
          </div>
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" className="link-button" onClick={onClose}>
              ✕
            </button>
          </span>
        </div>

        <div className="kb-cheatsheet-grid">
          {GROUPS.map((g) => (
            <section key={g.title} className="kb-cheatsheet-group">
              <h3 className="kb-cheatsheet-group-title">{g.title}</h3>
              <ul className="kb-cheatsheet-list">
                {g.rows.map((r, i) => (
                  <li key={i} className="kb-cheatsheet-row">
                    <span className="kb-cheatsheet-keys">
                      {r.keys.map((k, ki) => (
                        <span key={ki}>
                          <kbd className="kb-cheatsheet-key">{k}</kbd>
                          {ki < r.keys.length - 1 && (
                            <span className="kb-cheatsheet-plus">+</span>
                          )}
                        </span>
                      ))}
                    </span>
                    <span className="kb-cheatsheet-label">{r.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
