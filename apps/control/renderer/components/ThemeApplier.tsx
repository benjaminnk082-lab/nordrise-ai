'use client';

import { useEffect } from 'react';
import { settingsApi, type ThemeId } from '../lib/settings';
import { setWindowOpacity } from '../lib/bridge';

const VALID_THEMES: readonly ThemeId[] = [
  'dark',
  'light',
  'solar',
  'cyberpunk',
  'compact',
];

/**
 * ThemeApplier — invisible component that hydrates the user's theme + window
 * opacity once on mount and re-applies whenever settings.json changes (via
 * the storage event hack: each settings.set in any window broadcasts to all
 * tabs via window dispatch). Lives in the layout so login + app states both
 * pick up the user's preference.
 */
export function ThemeApplier() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await settingsApi.get();
        if (cancelled) return;
        const theme: ThemeId = VALID_THEMES.includes(s.theme as ThemeId)
          ? (s.theme as ThemeId)
          : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        const opacity =
          typeof s.windowOpacity === 'number' && Number.isFinite(s.windowOpacity)
            ? Math.max(0.7, Math.min(1.0, s.windowOpacity))
            : 1.0;
        // Best-effort — IPC fails silently in dev when the host hasn't loaded.
        await setWindowOpacity(opacity).catch(() => undefined);
      } catch {
        // Defaults already applied via the static data-theme attribute.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
