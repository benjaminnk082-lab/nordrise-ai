/**
 * routinesRunner.ts
 *
 * Cron-based scheduler for Routines. Each active Routine row gets a
 * node-cron task; the task spawns a fresh `claude -p` invocation via
 * ClaudeBridge (sessionId=null so each run starts a clean conversation),
 * records a RoutineRun row with status running → success/failed, and
 * optionally pushes a Telegram notification when channel ∈ {telegram, both}.
 *
 * `node-cron` is CJS — under NodeNext we must use `import * as cron` so the
 * default-namespace re-export resolves (see Hard constraint #8 in the
 * v0.1.14 spec).
 */

import * as cron from 'node-cron';
import type { PrismaClient, Routine } from '@prisma/client';
import type { Bot } from 'grammy';
import { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

export interface RunnerDeps {
  prisma: PrismaClient;
  bot: Bot;
  benjaminTelegramId: bigint;
}

const tasks = new Map<string, cron.ScheduledTask>();

export async function startRoutinesRunner(deps: RunnerDeps): Promise<void> {
  const all = await deps.prisma.routine.findMany({ where: { enabled: true } });
  for (const r of all) scheduleOne(r, deps);
  logger.info({ count: all.length }, 'routines runner started');
}

export async function rescheduleRoutine(id: string, deps: RunnerDeps): Promise<void> {
  const existing = tasks.get(id);
  if (existing) {
    existing.stop();
    tasks.delete(id);
  }
  const r = await deps.prisma.routine.findUnique({ where: { id } });
  if (!r || !r.enabled) return;
  scheduleOne(r, deps);
}

export function unscheduleRoutine(id: string): void {
  const t = tasks.get(id);
  if (t) {
    t.stop();
    tasks.delete(id);
  }
}

function scheduleOne(r: Routine, deps: RunnerDeps): void {
  if (!cron.validate(r.schedule)) {
    logger.warn({ id: r.id, schedule: r.schedule }, 'invalid cron, skipping');
    return;
  }
  const task = cron.schedule(
    r.schedule,
    () => {
      void runOnce(r.id, deps);
    },
    { scheduled: true },
  );
  tasks.set(r.id, task);
}

export async function runOnce(routineId: string, deps: RunnerDeps): Promise<void> {
  const r = await deps.prisma.routine.findUnique({ where: { id: routineId } });
  if (!r || !r.enabled) return;
  const run = await deps.prisma.routineRun.create({
    data: { routineId: r.id, status: 'running' },
  });
  // Start-of-run Telegram heads-up so Sean feels like a 24/7 employee.
  // Best-effort — a failure here must not abort the routine itself.
  if (r.channel === 'telegram' || r.channel === 'both') {
    try {
      await deps.bot.api.sendMessage(
        Number(deps.benjaminTelegramId),
        `🔧 Starter routine: ${r.name}`,
      );
    } catch (err) {
      logger.warn({ err, routineId: r.id }, 'routine telegram start-notify failed');
    }
  }
  const started = Date.now();
  try {
    const bridge = new ClaudeBridge();
    const result = await bridge.invoke({
      message: r.prompt,
      sessionId: null,
      ...(r.model ? { model: r.model } : {}),
    });
    const durationMs = Date.now() - started;
    if (result.isError) {
      await deps.prisma.routineRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          errorMsg: result.errorMessage ?? 'unknown',
          finishedAt: new Date(),
          durationMs,
        },
      });
      return;
    }
    await deps.prisma.routineRun.update({
      where: { id: run.id },
      data: {
        status: 'success',
        result: result.text,
        finishedAt: new Date(),
        durationMs,
      },
    });
    await deps.prisma.routine.update({
      where: { id: r.id },
      data: { lastRunAt: new Date() },
    });
    // Telegram notification (best-effort).
    if (r.channel === 'telegram' || r.channel === 'both') {
      try {
        // grammY's sendMessage chat_id type doesn't include bigint, but the
        // wire type is just a number. Convert via Number() for typical
        // Telegram user-ids (always within JS safe-integer range).
        await deps.bot.api.sendMessage(
          Number(deps.benjaminTelegramId),
          `📋 Routine "${r.name}":\n\n${result.text.slice(0, 3500)}`,
        );
      } catch (err) {
        logger.warn({ err, routineId: r.id }, 'routine telegram notify failed');
      }
    }
    // Desktop notify happens by virtue of the row being in the DB; the
    // renderer polls /control/routines/runs/recent every 30s.
  } catch (err) {
    const durationMs = Date.now() - started;
    await deps.prisma.routineRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorMsg: String((err as Error).message),
        finishedAt: new Date(),
        durationMs,
      },
    });
    logger.error({ err, routineId: r.id }, 'routine run crashed');
  }
}

/**
 * Test hook — clears all active scheduled tasks. Used by the unit test so
 * leftover tasks don't keep the event loop alive between cases.
 */
export function _resetTasksForTesting(): void {
  for (const t of tasks.values()) t.stop();
  tasks.clear();
}
