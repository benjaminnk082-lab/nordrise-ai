import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as cron from 'node-cron';

// vi.hoisted lets us share state with the vi.mock factory in a way that
// survives vitest's import-hoisting (which otherwise breaks CJS interop on
// the @prisma/client import above when the factory closes over module
// bindings declared in this file).
const hoisted = vi.hoisted(() => ({
  lastInvoke: null as { message: string; sessionId: string | null; model?: string } | null,
}));

vi.mock('../../claudeBridge.js', () => {
  // Lazy-require Node's events to avoid module-graph cycles during hoist.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { EventEmitter } = require('node:events');
  class FakeBridge extends EventEmitter {
    async invoke(opts: { message: string; sessionId: string | null; model?: string }) {
      hoisted.lastInvoke = opts;
      return {
        text: `routine-result for: ${opts.message}`,
        sessionId: 'claude-uuid-routine',
        durationMs: 5,
        isError: false,
        rateLimited: false,
        costUsd: 0,
      };
    }
  }
  return { ClaudeBridge: FakeBridge };
});

import { runOnce, _resetTasksForTesting } from './routinesRunner.js';

const prisma = new PrismaClient();
const fakeBot = {
  api: { sendMessage: vi.fn(async () => undefined) },
} as unknown as Parameters<typeof runOnce>[1]['bot'];

// In prod the new tables are reconciled on deploy via `prisma db push`.
// Locally we can't assume the spec'd CI step has run, so the test
// self-bootstraps the additive schema with idempotent CREATE TABLE IF NOT
// EXISTS statements. These mirror prisma/schema.prisma's Routine +
// RoutineRun models 1:1.
beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Routine" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "prompt" TEXT NOT NULL,
      "schedule" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "channel" TEXT NOT NULL DEFAULT 'desktop',
      "model" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastRunAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Routine_enabled_schedule_idx"
      ON "Routine" ("enabled", "schedule");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RoutineRun" (
      "id" TEXT PRIMARY KEY,
      "routineId" TEXT NOT NULL,
      "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finishedAt" TIMESTAMP(3),
      "status" TEXT NOT NULL,
      "result" TEXT,
      "errorMsg" TEXT,
      "durationMs" INTEGER,
      CONSTRAINT "RoutineRun_routineId_fkey" FOREIGN KEY ("routineId")
        REFERENCES "Routine"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "RoutineRun_routineId_startedAt_idx"
      ON "RoutineRun" ("routineId", "startedAt");
  `);
});

beforeEach(async () => {
  hoisted.lastInvoke = null;
  await prisma.routineRun.deleteMany({});
  await prisma.routine.deleteMany({});
  _resetTasksForTesting();
});

afterAll(async () => {
  _resetTasksForTesting();
  await prisma.$disconnect();
});

describe('routinesRunner', () => {
  it('runOnce executes a routine and writes a success RoutineRun', async () => {
    const r = await prisma.routine.create({
      data: {
        name: 'Morgenbrief',
        prompt: 'Skriv en kort morgenbrief.',
        schedule: '0 9 * * *',
        channel: 'desktop',
      },
    });

    await runOnce(r.id, { prisma, bot: fakeBot, benjaminTelegramId: 0n });

    const runs = await prisma.routineRun.findMany({ where: { routineId: r.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('success');
    expect(runs[0]!.result).toContain('routine-result for: Skriv en kort morgenbrief.');
    expect(runs[0]!.finishedAt).not.toBeNull();
    expect(runs[0]!.durationMs).not.toBeNull();
    const refreshed = await prisma.routine.findUnique({ where: { id: r.id } });
    expect(refreshed!.lastRunAt).not.toBeNull();
    // sessionId=null contract: the runner must always start a fresh thread.
    expect(hoisted.lastInvoke?.sessionId).toBeNull();
  });

  it('skips when routine is disabled', async () => {
    const r = await prisma.routine.create({
      data: {
        name: 'Pause',
        prompt: 'noop',
        schedule: '0 9 * * *',
        enabled: false,
      },
    });
    await runOnce(r.id, { prisma, bot: fakeBot, benjaminTelegramId: 0n });
    const runs = await prisma.routineRun.findMany({ where: { routineId: r.id } });
    expect(runs).toHaveLength(0);
  });

  it('cron.validate accepts standard 5-field expressions', () => {
    expect(cron.validate('0 9 * * *')).toBe(true);
    expect(cron.validate('0 9 * * 1')).toBe(true);
    expect(cron.validate('*/5 * * * *')).toBe(true);
    expect(cron.validate('not a cron')).toBe(false);
  });

  it('posts a "🔧 Starter routine" Telegram heads-up when channel is telegram', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const bot = { api: { sendMessage } } as unknown as Parameters<typeof runOnce>[1]['bot'];
    const r = await prisma.routine.create({
      data: {
        name: 'Morgen-tg',
        prompt: 'noop',
        schedule: '0 9 * * *',
        channel: 'telegram',
      },
    });

    await runOnce(r.id, { prisma, bot, benjaminTelegramId: 999n });

    // Two messages: starter + completion. Both go to chatId=999.
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const calls = sendMessage.mock.calls.map((c: unknown[]) => c[1] as string);
    expect(calls[0]).toMatch(/^🔧 Starter routine: Morgen-tg/);
    expect(calls[1]).toMatch(/^📋 Routine "Morgen-tg":/);
  });

  it('does NOT post a starter heads-up when channel=desktop', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const bot = { api: { sendMessage } } as unknown as Parameters<typeof runOnce>[1]['bot'];
    const r = await prisma.routine.create({
      data: {
        name: 'Stille',
        prompt: 'noop',
        schedule: '0 9 * * *',
        channel: 'desktop',
      },
    });

    await runOnce(r.id, { prisma, bot, benjaminTelegramId: 999n });

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
