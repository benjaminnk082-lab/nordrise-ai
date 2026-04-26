import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import request from 'supertest';
import { makeControlUploadRouter } from './uploadRoute.js';

let inboxDir: string;
beforeEach(() => {
  inboxDir = mkdtempSync(join(tmpdir(), 'inbox-'));
});

function app() {
  const a = express();
  a.use('/control', makeControlUploadRouter({ inboxDir, allowedTokens: ['t1'], maxFileSizeBytes: 25 * 1024 * 1024 }));
  return a;
}

describe('POST /control/upload', () => {
  it('rejects without bearer', async () => {
    const res = await request(app()).post('/control/upload').attach('file', Buffer.from('hi'), 'a.txt');
    expect(res.status).toBe(401);
  });
  it('writes file with cuid prefix and returns workspacePath', async () => {
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', Buffer.from('hello'), 'note.txt');
    expect(res.status).toBe(200);
    expect(res.body.workspacePath).toMatch(/note\.txt$/);
    const onDisk = readdirSync(inboxDir);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatch(/-note\.txt$/);
  });
  it('rejects executable by magic-byte sniff', async () => {
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ header
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', exeBytes, 'evil.exe');
    expect(res.status).toBe(415);
  });
  it('sanitizes filename', async () => {
    const res = await request(app())
      .post('/control/upload')
      .set('Authorization', 'Bearer t1')
      .attach('file', Buffer.from('x'), '../../../etc/passwd.txt');
    expect(res.status).toBe(200);
    expect(res.body.workspacePath).not.toContain('..');
    expect(res.body.workspacePath).toMatch(/passwd\.txt$/);
  });
});
