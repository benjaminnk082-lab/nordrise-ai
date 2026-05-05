/**
 * heartbeat — OpenClaw-style idle-tick daemon helpers (pure parts).
 *
 * The daemon itself lives in `main/heartbeat.ts` (Electron-aware,
 * `setInterval` + `BrowserWindow.isFocused()`); this module is the
 * pure-Node logic that the daemon and the unit canary share.
 *
 * Sentinel `HEARTBEAT_OK` (CLAUDE.md §16) — Sean replies with exactly
 * this string when nothing needs surfacing. Any other reply triggers a
 * Windows toast.
 */

export const HEARTBEAT_OK_SENTINEL = 'HEARTBEAT_OK';

/**
 * Strict comparison — see §16. We don't trim, lowercase, or regex.
 * A near-miss like "Heartbeat OK" intentionally still triggers a toast
 * so the user notices that the persona drifted.
 */
export function isHeartbeatOk(reply: string): boolean {
  return reply === HEARTBEAT_OK_SENTINEL;
}

export interface HeartbeatPromptOpts {
  /** Optional project context to include — current "active" project id. */
  projectName?: string | null;
  /** Optional ISO timestamp of the previous tick. */
  lastTickIso?: string | null;
}

/**
 * Build the prompt sent to Sean each tick. Includes the literal contents
 * of HEARTBEAT.md plus a strict instruction to reply with the sentinel
 * when there's nothing to surface.
 */
export function buildHeartbeatPrompt(
  heartbeatBody: string,
  opts: HeartbeatPromptOpts = {},
): string {
  const ctx: string[] = [];
  if (opts.projectName) ctx.push(`Active project: ${opts.projectName}`);
  if (opts.lastTickIso) ctx.push(`Forrige heartbeat-tick: ${opts.lastTickIso}`);
  const ctxBlock = ctx.length > 0 ? `\n\n${ctx.join('\n')}\n` : '';
  return [
    '[System: heartbeat tick — ikke en samtale, ikke et nytt minne. Sjekk',
    'om noe haster eller har endret status.]',
    '',
    'Følgende er innholdet i `Sean/HEARTBEAT.md`:',
    '',
    '```markdown',
    heartbeatBody.trim() || '(tom)',
    '```',
    ctxBlock,
    'Skal noe gjøres NÅ?',
    '- Hvis nei: svar med ÉN linje med eksakt tekst:',
    `  ${HEARTBEAT_OK_SENTINEL}`,
    '- Hvis ja: svar i opptil 3 linjer hva du ser, hvorfor det haster, og',
    '  hva du foreslår at vi gjør. Bare det. Ingen annet.',
  ].join('\n');
}

/**
 * Suggested default tick interval (ms). Exported so the IPC layer can
 * read the same value as the canary suite.
 */
export const HEARTBEAT_DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
