import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupInbox } from './inboxCleanup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inbox-'));
});

describe('cleanupInbox', () => {
  it('deletes files older than maxAgeMs', async () => {
    const old = join(dir, 'old.txt');
    const fresh = join(dir, 'fresh.txt');
    writeFileSync(old, 'old');
    writeFileSync(fresh, 'fresh');
    const tenDaysAgo = Date.now() / 1000 - 10 * 86400;
    utimesSync(old, tenDaysAgo, tenDaysAgo);

    const removed = await cleanupInbox(dir, 7 * 86400 * 1000);
    expect(removed).toBe(1);
    const remaining = readdirSync(dir);
    expect(remaining).toEqual(['fresh.txt']);
  });
  it('returns 0 if directory does not exist', async () => {
    const removed = await cleanupInbox(join(dir, 'no-such-subdir'), 1000);
    expect(removed).toBe(0);
  });
});
