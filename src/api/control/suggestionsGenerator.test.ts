import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Hoisted state so the vi.mock factory can mutate per-case behaviour.
// vi.hoisted lets the mock factory close over this state across vitest's
// import-hoisting pass (same trick as routinesRunner.test.ts).
const hoisted = vi.hoisted(() => ({
  bridgeText: '' as string,
  isError: false as boolean,
  errorMessage: undefined as string | undefined,
  lastInvoke: null as
    | { message: string; sessionId: string | null; model?: string }
    | null,
}));

vi.mock('../../claudeBridge.js', () => {
  // Lazy-require Node's events to avoid module-graph cycles during hoist.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { EventEmitter } = require('node:events');
  class FakeBridge extends EventEmitter {
    async invoke(opts: { message: string; sessionId: string | null; model?: string }) {
      hoisted.lastInvoke = opts;
      return {
        text: hoisted.bridgeText,
        sessionId: 'claude-uuid-suggestion',
        durationMs: 5,
        isError: hoisted.isError,
        errorMessage: hoisted.errorMessage,
        rateLimited: false,
        costUsd: 0,
      };
    }
  }
  return { ClaudeBridge: FakeBridge };
});

import { generateOnce, executeApproved } from './suggestionsGenerator.js';

const prisma = new PrismaClient();

// Self-bootstrap the additive Suggestion table so the test runs even when the
// outer migration step hasn't fired locally — same pattern as routinesRunner.test.ts.
beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Suggestion" (
      "id" TEXT PRIMARY KEY,
      "type" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "rationale" TEXT NOT NULL,
      "prompt" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "decidedAt" TIMESTAMP(3),
      "executedAt" TIMESTAMP(3),
      "result" TEXT,
      "errorMsg" TEXT,
      "durationMs" INTEGER
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Suggestion_status_expiresAt_idx"
      ON "Suggestion" ("status", "expiresAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Suggestion_createdAt_idx"
      ON "Suggestion" ("createdAt");
  `);
});

beforeEach(async () => {
  hoisted.bridgeText = '';
  hoisted.isError = false;
  hoisted.errorMessage = undefined;
  hoisted.lastInvoke = null;
  await prisma.suggestion.deleteMany({});
  // Quiet window requires no Messages in the last 60 min.
  await prisma.message.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('suggestionsGenerator', () => {
  it('parses a valid JSON array and creates Suggestion rows', async () => {
    hoisted.bridgeText = JSON.stringify([
      {
        type: 'research',
        title: 'Sjekk Three.js r170 changelog',
        rationale: 'Du har drevet med Three.js siste uka.',
        prompt: 'Les Three.js r170 release notes og oppsummer det som er relevant for Nordrise.',
        expiresInH: 24,
      },
      {
        type: 'cleanup',
        title: 'Rydd Inbox/',
        rationale: 'Inbox har 12 ulagrede notater.',
        prompt: 'Gå gjennom /app/workspace/vault/Inbox/ og foreslå tagging.',
        expiresInH: 12,
      },
    ]);

    const result = await generateOnce({ prisma });

    expect(result.skipped).toBe(false);
    expect(result.generated).toBe(2);
    const rows = await prisma.suggestion.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // Hard constraint: generator MUST use Haiku.
    expect(hoisted.lastInvoke?.model).toBe('claude-haiku-4-5');
    expect(hoisted.lastInvoke?.sessionId).toBeNull();
  });

  it('extracts JSON even when wrapped in prose / markdown', async () => {
    hoisted.bridgeText = `Her er forslagene:\n\n\`\`\`json\n${JSON.stringify([
      {
        type: 'note',
        title: 'Skriv kort daglig',
        rationale: 'Du har ikke skrevet i Daglig/ på 3 dager.',
        prompt: 'Lag et utkast til dagens notat med 3 temaer fra Inbox.',
        expiresInH: 24,
      },
    ])}\n\`\`\``;

    const result = await generateOnce({ prisma });
    expect(result.generated).toBe(1);
  });

  it('skips when JSON is invalid', async () => {
    hoisted.bridgeText = '[ this is not valid json ]';
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_json');
    expect(await prisma.suggestion.count()).toBe(0);
  });

  it('skips when no JSON array present at all', async () => {
    hoisted.bridgeText = 'Beklager, jeg har ingen forslag akkurat nå.';
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_json');
  });

  it('skips when schema validation fails (e.g. unknown type)', async () => {
    hoisted.bridgeText = JSON.stringify([
      {
        type: 'doomsday',
        title: 'Ulovlig type',
        rationale: 'Skal feile.',
        prompt: 'noop',
        expiresInH: 24,
      },
    ]);
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_schema');
  });

  it('skips when bridge errors', async () => {
    hoisted.isError = true;
    hoisted.errorMessage = 'usage limit';
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('bridge_error');
  });

  it('skips when there are >= 5 pending suggestions already', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.suggestion.create({
        data: {
          type: 'idea',
          title: `Forslag ${i}`,
          rationale: 'fyll',
          prompt: 'noop',
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
    hoisted.bridgeText = JSON.stringify([]);
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('too_many_pending');
    // Bridge was never even called.
    expect(hoisted.lastInvoke).toBeNull();
  });

  it('skips when not in quiet window (recent message exists)', async () => {
    // Need a ControlSession to attach the message to (Message FK is nullable
    // on both sides, but we use controlSessionId here to keep it realistic).
    const cs = await prisma.controlSession.create({ data: {} });
    await prisma.message.create({
      data: {
        controlSessionId: cs.id,
        role: 'user',
        content: 'hei',
      },
    });
    hoisted.bridgeText = JSON.stringify([]);
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_quiet');
    // Cleanup so other tests remain quiet.
    await prisma.message.deleteMany({});
    await prisma.controlSession.deleteMany({});
  });

  it('caps array at 3 (zod .max(3))', async () => {
    hoisted.bridgeText = JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({
        type: 'idea',
        title: `Forslag ${i}`,
        rationale: 'fyll',
        prompt: 'noop',
        expiresInH: 24,
      })),
    );
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid_schema');
  });

  it('returns zero-generated for empty array', async () => {
    hoisted.bridgeText = '[]';
    const result = await generateOnce({ prisma });
    expect(result.skipped).toBe(false);
    expect(result.generated).toBe(0);
  });

  it('executeApproved transitions approved -> done with result', async () => {
    const s = await prisma.suggestion.create({
      data: {
        type: 'check',
        title: 'Sjekk noe',
        rationale: 'fordi',
        prompt: 'Sjekk Inbox',
        status: 'approved',
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    hoisted.bridgeText = 'sjekka, alt ok';
    await executeApproved(prisma, s.id);
    const after = await prisma.suggestion.findUnique({ where: { id: s.id } });
    expect(after!.status).toBe('done');
    expect(after!.result).toBe('sjekka, alt ok');
    expect(after!.executedAt).not.toBeNull();
  });

  it('executeApproved is a no-op for non-approved rows', async () => {
    const s = await prisma.suggestion.create({
      data: {
        type: 'check',
        title: 'pending row',
        rationale: 'noe',
        prompt: 'noop',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    hoisted.bridgeText = 'should not run';
    await executeApproved(prisma, s.id);
    const after = await prisma.suggestion.findUnique({ where: { id: s.id } });
    expect(after!.status).toBe('pending');
    expect(after!.result).toBeNull();
  });

  it('executeApproved writes failed when bridge errors', async () => {
    const s = await prisma.suggestion.create({
      data: {
        type: 'check',
        title: 'will fail',
        rationale: 'ratelimit',
        prompt: 'noop',
        status: 'approved',
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    hoisted.isError = true;
    hoisted.errorMessage = 'rate-limit';
    await executeApproved(prisma, s.id);
    const after = await prisma.suggestion.findUnique({ where: { id: s.id } });
    expect(after!.status).toBe('failed');
    expect(after!.errorMsg).toContain('rate-limit');
  });
});
