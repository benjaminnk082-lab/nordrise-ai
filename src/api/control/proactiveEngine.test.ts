/**
 * proactiveEngine.test.ts
 *
 * Hard-constraint coverage for the v0.3.3 proactive engine. Each guardrail
 * gets its own case so a regression that breaks any one of them surfaces
 * immediately:
 *   1. envDisabled → engine never schedules / runOnce returns 'disabled'
 *      via settings.enabled=false
 *   2. quiet hours → 'quiet_hours' (mocked Date)
 *   3. per-hour rate limit → 'rate_limited' once maxPerHour reached
 *   4. user active in last 30 min → 'skipped' (reason: user_active)
 *   5. happy path: bridge JSON with send=true → bot.api.sendMessage called +
 *      'sent' attempt persisted
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';
import { PrismaClient } from '@prisma/client';

// Hoisted mock state. Mirrors the routinesRunner.test.ts pattern so the
// vi.mock factory can mutate per-case behaviour across vitest hoisting.
const hoisted = vi.hoisted(() => ({
  bridgeText: '' as string,
  isError: false as boolean,
  errorMessage: undefined as string | undefined,
  costUsd: 0 as number,
  invocations: 0 as number,
  lastInvoke: null as { message: string; sessionId: string | null; model?: string } | null,
}));

vi.mock('../../claudeBridge.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { EventEmitter } = require('node:events');
  class FakeBridge extends EventEmitter {
    async invoke(opts: { message: string; sessionId: string | null; model?: string }) {
      hoisted.invocations++;
      hoisted.lastInvoke = opts;
      return {
        text: hoisted.bridgeText,
        sessionId: 'claude-uuid-proactive',
        durationMs: 5,
        isError: hoisted.isError,
        errorMessage: hoisted.errorMessage,
        rateLimited: false,
        costUsd: hoisted.costUsd,
      };
    }
  }
  return { ClaudeBridge: FakeBridge };
});

import { runOnce, inQuietHours, type ProactiveDeps } from './proactiveEngine.js';

const prisma = new PrismaClient();

const sendMessageMock = vi.fn(async () => undefined);
const fakeBot = { api: { sendMessage: sendMessageMock } } as unknown as ProactiveDeps['bot'];

function deps(envDisabled = false): ProactiveDeps {
  return {
    prisma,
    bot: fakeBot,
    benjaminTelegramId: 12345n,
    envDisabled,
  };
}

// Self-bootstrap the new schema so the test runs even when prisma db push
// hasn't been executed locally — same pattern as routinesRunner.test.ts /
// suggestionsGenerator.test.ts.
beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProactiveAttempt" (
      "id" TEXT PRIMARY KEY,
      "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "decision" TEXT NOT NULL,
      "reason" TEXT,
      "message" TEXT,
      "category" TEXT,
      "costUsd" DOUBLE PRECISION
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProactiveAttempt_triggeredAt_idx"
      ON "ProactiveAttempt" ("triggeredAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProactiveAttempt_decision_triggeredAt_idx"
      ON "ProactiveAttempt" ("decision", "triggeredAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProactiveSettings" (
      "id" TEXT PRIMARY KEY,
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "quietHourStart" INTEGER NOT NULL DEFAULT 22,
      "quietHourEnd" INTEGER NOT NULL DEFAULT 8,
      "maxPerHour" INTEGER NOT NULL DEFAULT 3,
      "maxPerDay" INTEGER NOT NULL DEFAULT 10,
      "cadenceMin" INTEGER NOT NULL DEFAULT 15,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

beforeEach(async () => {
  hoisted.bridgeText = '';
  hoisted.isError = false;
  hoisted.errorMessage = undefined;
  hoisted.costUsd = 0;
  hoisted.invocations = 0;
  hoisted.lastInvoke = null;
  sendMessageMock.mockClear();
  await prisma.proactiveAttempt.deleteMany({});
  await prisma.proactiveSettings.deleteMany({});
  await prisma.reaction.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------- inQuietHours pure-function unit ----------

describe('inQuietHours', () => {
  it('treats start as inclusive, end as exclusive (no wrap)', () => {
    const s = { quietHourStart: 9, quietHourEnd: 17 };
    expect(inQuietHours(s, new Date(2026, 0, 1, 9, 0))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 16, 59))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 17, 0))).toBe(false);
    expect(inQuietHours(s, new Date(2026, 0, 1, 8, 59))).toBe(false);
  });

  it('handles wrap-around 22→8 correctly', () => {
    const s = { quietHourStart: 22, quietHourEnd: 8 };
    expect(inQuietHours(s, new Date(2026, 0, 1, 22, 0))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 23, 30))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 7, 59))).toBe(true);
    expect(inQuietHours(s, new Date(2026, 0, 1, 8, 0))).toBe(false);
    expect(inQuietHours(s, new Date(2026, 0, 1, 14, 0))).toBe(false);
  });
});

// ---------- runOnce guardrails ----------

describe('runOnce — guardrails', () => {
  it('returns disabled when settings.enabled=false', async () => {
    await prisma.proactiveSettings.create({
      data: { enabled: false },
    });
    // Force a non-quiet hour so we can be sure the disabled-check is what
    // short-circuits us.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));

    const result = await runOnce(deps());

    expect(result.decision).toBe('disabled');
    const attempts = await prisma.proactiveAttempt.findMany({});
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.decision).toBe('disabled');
    // Bridge MUST NOT have been called.
    expect(hoisted.invocations).toBe(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('returns quiet_hours during the quiet window (e.g. 23:00 with default 22-08)', async () => {
    // Default singleton settings (22→8 quiet).
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0));

    const result = await runOnce(deps());

    expect(result.decision).toBe('quiet_hours');
    const attempts = await prisma.proactiveAttempt.findMany({});
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.decision).toBe('quiet_hours');
    expect(hoisted.invocations).toBe(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('returns rate_limited once maxPerHour sent attempts already exist', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    // Pre-fill 3 'sent' attempts inside the last hour. Default maxPerHour=3.
    for (let i = 0; i < 3; i++) {
      await prisma.proactiveAttempt.create({
        data: {
          decision: 'sent',
          triggeredAt: new Date(Date.now() - 5 * 60 * 1000),
          message: `prev ${i}`,
        },
      });
    }

    const result = await runOnce(deps());

    expect(result.decision).toBe('rate_limited');
    expect(result.reason).toContain('/h');
    const attempts = await prisma.proactiveAttempt.findMany({
      where: { decision: 'rate_limited' },
    });
    expect(attempts).toHaveLength(1);
    expect(hoisted.invocations).toBe(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("skips with reason 'user_active' when a Message exists in the last 30 min", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    const cs = await prisma.controlSession.create({ data: {} });
    await prisma.message.create({
      data: {
        controlSessionId: cs.id,
        role: 'user',
        content: 'midt i samtale',
        // createdAt defaults to now() which is the faked 14:00.
      },
    });

    const result = await runOnce(deps());

    expect(result.decision).toBe('skipped');
    expect(result.reason).toBe('user_active');
    const attempts = await prisma.proactiveAttempt.findMany({});
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.reason).toBe('user_active');
    expect(hoisted.invocations).toBe(0);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('sends Telegram + writes a sent attempt when bridge returns valid JSON with send=true', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    hoisted.bridgeText = JSON.stringify({
      send: true,
      category: 'status',
      reason: 'oppdatert MEMORY.md',
      message: 'Jeg har lest ferdig vaulten og oppdatert MEMORY.md.',
    });
    hoisted.costUsd = 0.0042;

    const result = await runOnce(deps());

    expect(result.decision).toBe('sent');
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith(
      12345,
      'Jeg har lest ferdig vaulten og oppdatert MEMORY.md.',
    );
    // Hard constraint: Haiku.
    expect(hoisted.lastInvoke?.model).toBe('claude-haiku-4-5');
    expect(hoisted.lastInvoke?.sessionId).toBeNull();

    const attempts = await prisma.proactiveAttempt.findMany({});
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.decision).toBe('sent');
    expect(attempts[0]!.category).toBe('status');
    expect(attempts[0]!.message).toBe(
      'Jeg har lest ferdig vaulten og oppdatert MEMORY.md.',
    );
    expect(attempts[0]!.costUsd).toBeCloseTo(0.0042);
  });

  it('skips with no_json when bridge returns prose without JSON', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    hoisted.bridgeText = 'Beklager, ingenting å si.';

    const result = await runOnce(deps());

    expect(result.decision).toBe('skipped');
    expect(result.reason).toBe('no_json');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('skips when Sean voluntarily decides send=false', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    hoisted.bridgeText = JSON.stringify({
      send: false,
      reason: 'ingenting konkret akkurat nå',
    });

    const result = await runOnce(deps());

    expect(result.decision).toBe('skipped');
    expect(result.reason).toBe('ingenting konkret akkurat nå');
    expect(sendMessageMock).not.toHaveBeenCalled();
    const attempts = await prisma.proactiveAttempt.findMany({});
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.decision).toBe('skipped');
  });

  it('skips with bridge_error when bridge isError=true', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 14, 0));
    hoisted.isError = true;
    hoisted.errorMessage = 'rate-limit';

    const result = await runOnce(deps());

    expect(result.decision).toBe('skipped');
    expect(result.reason).toBe('bridge_error');
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});
