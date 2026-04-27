import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  retrieveContext,
  invalidateVaultCache,
  score,
} from './retrieval.js';

class FakeBridge extends EventEmitter {
  public lastInvoke: { message: string; model?: string } | null = null;
  constructor(
    private readonly behaviour: {
      text?: string;
      isError?: boolean;
    } = {},
  ) {
    super();
  }
  async invoke(opts: { message: string; sessionId: string | null; model?: string }) {
    this.lastInvoke = { message: opts.message, model: opts.model };
    return {
      text: this.behaviour.text ?? '',
      sessionId: 'fake-sid',
      durationMs: 1,
      isError: this.behaviour.isError ?? false,
      rateLimited: false,
      costUsd: 0,
    };
  }
}

let vaultDir = '';

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'retr-vault-'));
  invalidateVaultCache();
});

afterEach(() => {
  try {
    rmSync(vaultDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  invalidateVaultCache();
});

function writeMd(rel: string, content: string): void {
  const full = join(vaultDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('retrieveContext', () => {
  it('returns empty string for short messages (< 25 chars)', async () => {
    writeMd('Sean/MEMORY.md', '# Memory\n\nNordrise er Benjamins selskap');
    const bridge = new FakeBridge({
      text: JSON.stringify(['nordrise']),
    });
    const out = await retrieveContext({
      vaultDir,
      message: 'hei',
      bridge: bridge as never,
    });
    expect(out).toBe('');
    // No keyword call should have been made because we short-circuit.
    expect(bridge.lastInvoke).toBeNull();
  });

  it('returns empty string when no JSON keywords come back', async () => {
    writeMd('a.md', '# A\n\nNordrise innhold');
    const bridge = new FakeBridge({ text: 'no json here' });
    const out = await retrieveContext({
      vaultDir,
      message: 'hva er nytt om Nordrise prosjektet?',
      bridge: bridge as never,
    });
    expect(out).toBe('');
  });

  it('returns empty string when keywords have no hits', async () => {
    writeMd('foo.md', '# Foo\n\nbar baz');
    const bridge = new FakeBridge({
      text: JSON.stringify(['nordrise', 'happy time']),
    });
    const out = await retrieveContext({
      vaultDir,
      message: 'hva er nytt om Nordrise og Happy Time?',
      bridge: bridge as never,
    });
    expect(out).toBe('');
  });

  it('returns formatted context block with up to 3 hits, sorted by score', async () => {
    writeMd(
      'Sean/MEMORY.md',
      '# MEMORY\n\nNordrise: Benjamins startup. Happy Time: produkt.',
    );
    writeMd('Inbox/random.md', 'random innhold uten match');
    writeMd('Grunderskap/Nordrise.md', 'Nordrise prosjektplan og roadmap');
    writeMd('Daglig/2026-04-26.md', 'idag jobbet med Happy Time funksjoner');
    writeMd('foo.md', 'helt urelatert innhold');

    const bridge = new FakeBridge({
      text: JSON.stringify(['Nordrise', 'Happy Time', 'roadmap']),
    });
    const out = await retrieveContext({
      vaultDir,
      message: 'oppsummer status på Nordrise og Happy Time',
      bridge: bridge as never,
    });
    expect(out).toContain('Relevant kontekst fra Obsidian-vault');
    // Title-match wins: Nordrise.md should appear (title=Nordrise → +10).
    expect(out).toContain('Grunderskap/Nordrise.md');
    // The unmatched files must NOT be in the output.
    expect(out).not.toContain('Inbox/random.md');
    expect(out).not.toContain('foo.md');
    // Output must be capped to 3 sections.
    const sectionCount = (out.match(/^### /gm) ?? []).length;
    expect(sectionCount).toBeLessThanOrEqual(3);
  });

  it('returns "" when extraction is bridge-error', async () => {
    writeMd('a.md', 'Nordrise content');
    const bridge = new FakeBridge({ isError: true });
    const out = await retrieveContext({
      vaultDir,
      message: 'fortell meg om Nordrise prosjektet i detalj',
      bridge: bridge as never,
    });
    expect(out).toBe('');
  });

  it('caches vault until invalidate is called', async () => {
    writeMd('a.md', '# A\n\nNordrise');
    const bridge = new FakeBridge({ text: JSON.stringify(['Nordrise']) });
    const out1 = await retrieveContext({
      vaultDir,
      message: 'fortell meg om Nordrise prosjektet i detalj',
      bridge: bridge as never,
    });
    expect(out1).toContain('a.md');

    // Add a new file but DON'T invalidate the cache. Top match should still
    // be the cached single file.
    writeMd('b.md', '# B\n\nNordrise nytt');
    const out2 = await retrieveContext({
      vaultDir,
      message: 'fortell meg om Nordrise prosjektet i detalj',
      bridge: bridge as never,
    });
    expect(out2).toContain('a.md');
    expect(out2).not.toContain('b.md');

    // After invalidate, b.md becomes visible.
    invalidateVaultCache();
    const out3 = await retrieveContext({
      vaultDir,
      message: 'fortell meg om Nordrise prosjektet i detalj',
      bridge: bridge as never,
    });
    expect(out3).toContain('b.md');
  });
});

describe('score()', () => {
  it('weights title hits higher than preview hits', () => {
    const titleHit = {
      path: 'Nordrise.md',
      title: 'Nordrise',
      preview: 'no match',
      full: 'no match',
    };
    const previewHit = {
      path: 'other.md',
      title: 'other',
      preview: 'mentions Nordrise once',
      full: 'mentions Nordrise once',
    };
    expect(score(titleHit, ['nordrise'])).toBeGreaterThan(
      score(previewHit, ['nordrise']),
    );
  });

  it('returns 0 when no keywords', () => {
    const f = { path: 'a', title: 'a', preview: 'a', full: 'a' };
    expect(score(f, [])).toBe(0);
  });
});
