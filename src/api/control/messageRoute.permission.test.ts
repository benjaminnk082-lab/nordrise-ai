/**
 * Unit tests for `buildPermissionFragment`.
 *
 * Pure function — no DB, no IPC, no bridge. Covers the three modes
 * (auto / manual / custom) plus the edge cases that the v0.5.1 + v0.5.2
 * permission feature relies on. Adding these guards the type narrowing
 * applied in `messageRoute.ts:147,156` (foundation TS-fix) so a future
 * refactor that tries to widen `labels` again will fail at test time
 * rather than at typecheck.
 */
import { describe, it, expect } from 'vitest';
import { buildPermissionFragment } from './messageRoute.js';

describe('buildPermissionFragment', () => {
  it('returns undefined when mode is missing', () => {
    expect(buildPermissionFragment(undefined, undefined)).toBeUndefined();
  });

  it('returns undefined when mode is auto (implicit default)', () => {
    expect(buildPermissionFragment('auto', undefined)).toBeUndefined();
    // even with explicit perAction, auto suppresses the fragment
    expect(
      buildPermissionFragment('auto', { vaultWrite: 'ask' }),
    ).toBeUndefined();
  });

  it('emits the manual-mode fragment regardless of perAction', () => {
    const out = buildPermissionFragment('manual', undefined);
    expect(out).toBeDefined();
    expect(out).toContain('manual mode');
    expect(out).toContain('eksplisitt bekreftelse');
    // perAction is ignored under manual mode — fragment is identical.
    const withPerAction = buildPermissionFragment('manual', {
      vaultWrite: 'block',
      shellExec: 'auto',
    });
    expect(withPerAction).toBe(out);
  });

  it('returns undefined for custom mode when perAction is empty', () => {
    expect(buildPermissionFragment('custom', undefined)).toBeUndefined();
    expect(buildPermissionFragment('custom', {})).toBeUndefined();
  });

  it('emits per-action lines for custom mode', () => {
    const out = buildPermissionFragment('custom', {
      vaultWrite: 'auto',
      telegramSend: 'ask',
      webSearch: 'block',
    });
    expect(out).toBeDefined();
    expect(out).toContain('custom mode');
    expect(out).toContain('skrive til vault / sean-notes: utfør uten å spørre');
    expect(out).toContain('sende Telegram-meldinger: spør først');
    expect(out).toContain('web-søk og scrape (Firecrawl/curl): blokkert');
    // unset keys must NOT appear
    expect(out).not.toContain('GitHub-API');
    expect(out).not.toContain('shell-kommandoer');
  });

  it('orders per-action lines deterministically (matches labels object order)', () => {
    const out = buildPermissionFragment('custom', {
      shellExec: 'block',
      vaultWrite: 'auto',
      githubAccess: 'ask',
    })!;
    const vaultIdx = out.indexOf('vault / sean-notes');
    const githubIdx = out.indexOf('GitHub-API');
    const shellIdx = out.indexOf('shell-kommandoer');
    expect(vaultIdx).toBeLessThan(githubIdx);
    expect(githubIdx).toBeLessThan(shellIdx);
  });

  it('handles all five known action keys', () => {
    const out = buildPermissionFragment('custom', {
      vaultWrite: 'auto',
      telegramSend: 'ask',
      webSearch: 'block',
      githubAccess: 'auto',
      shellExec: 'block',
    })!;
    // Five lines total — one per action (manual smoke check).
    const lines = out.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(5);
  });
});
