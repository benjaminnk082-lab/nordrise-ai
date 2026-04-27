import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { makeAppImprovementRouter } from './appImprovementRoute.js';
import { slugify } from './appImprovementSpec.js';

const prisma = new PrismaClient();

class FakeBridge extends EventEmitter {
  public lastInvoke: { message: string; model?: string } | null = null;
  constructor(
    private readonly behaviour: { text?: string; isError?: boolean } = {},
  ) {
    super();
  }
  async invoke(opts: { message: string; sessionId: string | null; model?: string }) {
    this.lastInvoke = { message: opts.message, model: opts.model };
    return {
      text: this.behaviour.text ?? '',
      sessionId: 'sid',
      durationMs: 1,
      isError: this.behaviour.isError ?? false,
      rateLimited: false,
      costUsd: 0,
    };
  }
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppImprovement" (
      "id" TEXT PRIMARY KEY,
      "category" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "rationale" TEXT NOT NULL,
      "patternEvidence" TEXT,
      "proposedSpec" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "approvedAt" TIMESTAMP(3),
      "specWrittenAt" TIMESTAMP(3),
      "vaultPath" TEXT
    );
  `);
});

beforeEach(async () => {
  await prisma.appImprovement.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

let seanNotesDir = '';

function buildApp(opts?: {
  watcherText?: string;
  specText?: string;
}) {
  seanNotesDir = mkdtempSync(join(tmpdir(), 'ai-sean-notes-'));
  const app = express();
  app.use(express.json());
  const watcherBridge = new FakeBridge({ text: opts?.watcherText ?? '[]' });
  const specBridge = new FakeBridge({ text: opts?.specText ?? '# spec' });
  app.use(
    '/control',
    makeAppImprovementRouter({
      prisma,
      seanNotesDir,
      allowedTokens: ['t1'],
      watcherDeps: { makeBridge: () => watcherBridge as never },
      specDeps: { makeBridge: () => specBridge as never },
    }),
  );
  return { app, watcherBridge, specBridge };
}

afterAll(() => {
  if (seanNotesDir && existsSync(seanNotesDir)) {
    try {
      rmSync(seanNotesDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('app-improvements router', () => {
  it('rejects without bearer token', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/control/app-improvements');
    expect(res.status).toBe(401);
  });

  it('lists rows newest first', async () => {
    await prisma.appImprovement.create({
      data: {
        category: 'feature',
        title: 'A',
        description: 'd',
        rationale: 'r',
      },
    });
    await prisma.appImprovement.create({
      data: {
        category: 'ux',
        title: 'B',
        description: 'd',
        rationale: 'r',
      },
    });
    const { app } = buildApp();
    const res = await request(app)
      .get('/control/app-improvements')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.improvements.length).toBe(2);
    // ISO strings
    expect(typeof res.body.improvements[0].createdAt).toBe('string');
  });

  it('scan-now invokes watcher and persists proposals', async () => {
    const { app } = buildApp({
      watcherText: JSON.stringify([
        {
          category: 'bug-fix',
          title: 'Fix X',
          description: 'd',
          rationale: 'r',
        },
      ]),
    });
    const res = await request(app)
      .post('/control/app-improvements/scan-now')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(1);
    const rows = await prisma.appImprovement.findMany();
    expect(rows.length).toBe(1);
  });

  it('approve flips status and triggers spec generation (eventual consistency)', async () => {
    const created = await prisma.appImprovement.create({
      data: {
        category: 'feature',
        title: 'Improve onboarding flow',
        description: 'd',
        rationale: 'r',
      },
    });
    const { app } = buildApp({
      specText:
        '# Improve onboarding flow\n\n## Problem\n\nlots\n\n## Forslått løsning\n\nfix it',
    });
    const res = await request(app)
      .post(`/control/app-improvements/${created.id}/approve`)
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');

    // Spec generation is fire-and-forget; poll for the row to flip.
    let row = created;
    for (let i = 0; i < 25; i++) {
      const cur = await prisma.appImprovement.findUnique({
        where: { id: created.id },
      });
      if (cur && cur.status === 'spec-written') {
        row = cur;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(row.status).toBe('spec-written');
    expect(row.vaultPath).toMatch(
      /^app-improvements\/\d{4}-\d{2}-\d{2}-improve-onboarding-flow\.md$/,
    );
  });

  it('reject sets status=rejected', async () => {
    const created = await prisma.appImprovement.create({
      data: {
        category: 'feature',
        title: 'Drop feature',
        description: 'd',
        rationale: 'r',
      },
    });
    const { app } = buildApp();
    const res = await request(app)
      .post(`/control/app-improvements/${created.id}/reject`)
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  it('delete removes the row', async () => {
    const created = await prisma.appImprovement.create({
      data: {
        category: 'feature',
        title: 'X',
        description: 'd',
        rationale: 'r',
      },
    });
    const { app } = buildApp();
    const res = await request(app)
      .delete(`/control/app-improvements/${created.id}`)
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    const after = await prisma.appImprovement.findUnique({
      where: { id: created.id },
    });
    expect(after).toBeNull();
  });

  it('approve/reject/delete return 404 for missing id', async () => {
    const { app } = buildApp();
    for (const verb of ['approve', 'reject'] as const) {
      const r = await request(app)
        .post(`/control/app-improvements/no-such/${verb}`)
        .set('Authorization', 'Bearer t1');
      expect(r.status).toBe(404);
    }
    const r = await request(app)
      .delete('/control/app-improvements/no-such')
      .set('Authorization', 'Bearer t1');
    expect(r.status).toBe(404);
  });
});

describe('slugify()', () => {
  it('produces filename-safe ascii slug', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('Æpler & blåbær')).toBe('aepler-blabaer');
    expect(slugify('   ')).toBe('forbedring');
    expect(slugify('Fix the gateway 500 error on /control/foo')).toBe(
      'fix-the-gateway-500-error-on-control-foo',
    );
  });
});
