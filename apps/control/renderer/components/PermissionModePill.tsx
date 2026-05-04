'use client';
import { useEffect, useRef, useState } from 'react';
import {
  PERMISSION_MODE_META,
  type PermissionModeId,
} from '../lib/settings';

/**
 * Compact pill that surfaces (and lets the user switch) the current
 * permission mode from anywhere — typically the shell footer.
 *
 * Click → opens a small popover with the three modes; pick one to commit.
 * The pill color tracks mode so it's instantly readable: green = auto,
 * amber = manual, blue = custom.
 */
export interface PermissionModePillProps {
  mode: PermissionModeId;
  onChange: (next: PermissionModeId) => void;
}

export function PermissionModePill({ mode, onChange }: PermissionModePillProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const meta = PERMISSION_MODE_META[mode];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="perm-pill-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`perm-pill perm-pill-${mode}`}
        onClick={() => setOpen((v) => !v)}
        title={`Permissions: ${meta.label} — ${meta.sub}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="perm-pill-icon" aria-hidden="true">
          {meta.icon}
        </span>
        <span className="perm-pill-label">{meta.label}</span>
        <span className="perm-pill-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="perm-pill-menu" role="menu">
          {(['auto', 'manual', 'custom'] as const).map((m) => {
            const mm = PERMISSION_MODE_META[m];
            return (
              <button
                key={m}
                type="button"
                role="menuitemradio"
                aria-checked={m === mode}
                className={
                  'perm-pill-menu-row' +
                  (m === mode ? ' perm-pill-menu-row-active' : '')
                }
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <span className="perm-pill-menu-icon" aria-hidden="true">
                  {mm.icon}
                </span>
                <span className="perm-pill-menu-text">
                  <span className="perm-pill-menu-title">{mm.label}</span>
                  <span className="perm-pill-menu-sub">{mm.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
