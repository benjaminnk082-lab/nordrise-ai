import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeControlPersonaRouter } from './personaRoute.js';

function tempPersona(content: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'persona-test-'));
  const path = join(dir, 'sean.md');
  writeFileSync(path, content, 'utf8');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function buildApp(personaPath: string) {
  const app = express();
  app.use(express.json());
  app.use(
    '/control',
    makeControlPersonaRouter({ allowedTokens: ['t1'], personaPath }),
  );
  return app;
}

describe('GET /control/persona', () => {
  it('returns the persona content + sha1 fingerprint', async () => {
    const { path, cleanup } = tempPersona('# Du er Sean\n\nHello.\n');
    try {
      const res = await request(buildApp(path))
        .get('/control/persona')
        .set('Authorization', 'Bearer t1');
      expect(res.status).toBe(200);
      expect(res.body.persona).toBe('# Du er Sean\n\nHello.\n');
      expect(typeof res.body.sha1).toBe('string');
      expect(res.body.sha1).toHaveLength(40);
      expect(res.body.length).toBe(res.body.persona.length);
    } finally {
      cleanup();
    }
  });

  it('rejects without bearer token', async () => {
    const { path, cleanup } = tempPersona('hi');
    try {
      const res = await request(buildApp(path)).get('/control/persona');
      expect(res.status).toBe(401);
    } finally {
      cleanup();
    }
  });

  it('returns 500 with persona_unreadable when the file is missing', async () => {
    const res = await request(buildApp('/this/path/does/not/exist.md'))
      .get('/control/persona')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'persona_unreadable' });
  });
});
