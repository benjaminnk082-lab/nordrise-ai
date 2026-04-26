/**
 * cron.ts — small Norwegian explainer for cron strings used by Routines.
 *
 * Handles the common patterns the Settings UI presets surface, plus a
 * generic "Daglig HH:MM"-style fallback for `M H * * *` and weekday-pinned
 * variants. Anything more exotic falls back to the raw cron string.
 */

const PRESET_LABELS: Record<string, string> = {
  '0 * * * *': 'Hver time',
  '*/5 * * * *': 'Hver 5. minutt',
  '0 9 * * *': 'Daglig 09:00',
  '0 9 * * 1': 'Mandager 09:00',
};

const DOW_NB: Record<string, string> = {
  '0': 'Søndager',
  '1': 'Mandager',
  '2': 'Tirsdager',
  '3': 'Onsdager',
  '4': 'Torsdager',
  '5': 'Fredager',
  '6': 'Lørdager',
};

export function explainCron(s: string): string {
  const trimmed = s.trim();
  if (PRESET_LABELS[trimmed]) return PRESET_LABELS[trimmed]!;

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [m, h, dom, month, dow] = parts;

  // Daglig HH:MM
  if (m && h && /^\d+$/.test(m) && /^\d+$/.test(h)) {
    const time = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    if (dom === '*' && month === '*' && dow === '*') return `Daglig ${time}`;
    if (dom === '*' && month === '*' && dow && DOW_NB[dow]) {
      return `${DOW_NB[dow]} ${time}`;
    }
  }

  return trimmed;
}

export const CRON_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Daglig 09:00', value: '0 9 * * *' },
  { label: 'Mandager 09:00', value: '0 9 * * 1' },
  { label: 'Hver time', value: '0 * * * *' },
  { label: 'Hver 5. min', value: '*/5 * * * *' },
];
