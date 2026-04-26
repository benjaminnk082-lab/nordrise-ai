import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeRoutineLibraryRouter, ROUTINE_TEMPLATES } from './routineLibrary.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/control', makeRoutineLibraryRouter(['t1']));
  return app;
}

describe('GET /control/routine-library', () => {
  it('rejects without bearer token', async () => {
    const res = await request(buildApp()).get('/control/routine-library');
    expect(res.status).toBe(401);
  });

  it('returns the curated templates list', async () => {
    const res = await request(buildApp())
      .get('/control/routine-library')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBe(ROUTINE_TEMPLATES.length);
    // Required fields on every entry — guards against accidental shape drift.
    for (const t of res.body.templates) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(typeof t.emoji).toBe('string');
      expect(typeof t.prompt).toBe('string');
      expect(typeof t.schedule).toBe('string');
      expect(['desktop', 'telegram', 'both']).toContain(t.channel);
      expect([
        'daglig',
        'ukentlig',
        'codebase',
        'web-dev',
        'forretning',
      ]).toContain(t.category);
    }
  });

  it('uses unique ids per template', async () => {
    const ids = ROUTINE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
