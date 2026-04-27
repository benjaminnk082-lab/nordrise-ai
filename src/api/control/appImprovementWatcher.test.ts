import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { scanOnce } from './appImprovementWatcher.js';

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
      sessionId: 'fake-sid',
      durationMs: 1,
      isError: this.behaviour.isError ?? false,
      rateLimited: false,
      costUsd: 0,
    };
  }
}

beforeAll(async () => {
  // Self-bootstrap the AppImprovement table — same trick as Suggestion.
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
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AppImprovement_status_createdAt_idx"
      ON "AppImprovement" ("status", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AppImprovement_createdAt_idx"
      ON "AppImprovement" ("createdAt");
  `);
});

beforeEach(async () => {
  await prisma.appImprovement.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('appImprovementWatcher.scanOnce', () => {
  it('parses valid JSON proposals into AppImprovement rows', async () => {
    const bridge = new FakeBridge({
      text: JSON.stringify([
        {
          category: 'bug-fix',
          title: 'Fix retry button',
          description: 'Retry button does nothing on rate limit',
          rationale: '3 brukere har rapportert',
          patternEvidence: 'rate_limit logged 12x last 7d',
        },
        {
          category: 'ux',
          title: 'Add empty-state to suggestions list',
          description: 'List is blank when zero pending — confusing',
          rationale: 'Quiet windows commonly produce zero',
        },
      ]),
    });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    expect(result.skipped).toBe(false);
    expect(result.generated).toBe(2);
    const rows = await prisma.appImprovement.findMany();
    expect(rows.length).toBe(2);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toContain('Fix retry button');
    // Sonnet, not Haiku/Opus.
    expect(bridge.lastInvoke?.model).toBe('claude-sonnet-4-6');
  });

  it('skips on bridge error', async () => {
    const bridge = new FakeBridge({ isError: true });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('bridge_error');
    const count = await prisma.appImprovement.count();
    expect(count).toBe(0);
  });

  it('skips when JSON is unparseable', async () => {
    const bridge = new FakeBridge({ text: 'no array here' });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_json');
  });

  it('skips when schema validation fails', async () => {
    const bridge = new FakeBridge({
      text: JSON.stringify([{ category: 'doomsday', title: 'bad', description: 'd', rationale: 'r' }]),
    });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_schema');
  });

  it('skips with too_many_pending when 10+ rows are pending', async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.appImprovement.create({
        data: {
          category: 'feature',
          title: `t${i}`,
          description: 'd',
          rationale: 'r',
          status: 'pending',
        },
      });
    }
    const bridge = new FakeBridge({
      text: JSON.stringify([
        { category: 'ux', title: 'won', description: 'd', rationale: 'r' },
      ]),
    });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_many_pending');
  });

  it('caps proposals at 3 (schema)', async () => {
    const bridge = new FakeBridge({
      text: JSON.stringify(
        Array.from({ length: 5 }, (_, i) => ({
          category: 'feature',
          title: `t${i}`,
          description: 'd',
          rationale: 'r',
        })),
      ),
    });
    const result = await scanOnce({
      prisma,
      makeBridge: () => bridge as never,
    });
    // schema rejects oversize array
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_schema');
  });
});
