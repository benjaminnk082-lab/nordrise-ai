/**
 * routinesRoute.ts — REST API for Routines (Settings → Rutiner UI).
 *
 * Mounted under /control. All endpoints are gated by the same bearer-token
 * middleware as the other /control/* routes. Mutations call back into the
 * runner (rescheduleRoutine / unscheduleRoutine) so the in-memory cron
 * state stays in sync with the DB.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Bot } from 'grammy';
import { makeRequireControlToken } from './auth.js';
import {
  rescheduleRoutine,
  unscheduleRoutine,
  runOnce,
  type RunnerDeps,
} from './routinesRunner.js';

// Same model enum as messageRoute.ts to keep validation consistent across
// surfaces (`Hard constraint #3`).
const ModelEnum = z.enum([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

const Body = z.object({
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(10_000),
  schedule: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  channel: z.enum(['desktop', 'telegram', 'both']).default('desktop'),
  model: ModelEnum.optional(),
});

export interface RoutinesRouterDeps {
  prisma: PrismaClient;
  bot: Bot;
  benjaminTelegramId: bigint;
  allowedTokens: readonly string[];
}

export function makeRoutinesRouter(deps: RoutinesRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);
  const runnerDeps: RunnerDeps = {
    prisma: deps.prisma,
    bot: deps.bot,
    benjaminTelegramId: deps.benjaminTelegramId,
  };

  r.get('/routines', auth, async (_req, res) => {
    const rows = await deps.prisma.routine.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    });
    res.json({ routines: rows.map(rowToOut) });
  });

  r.post('/routines', auth, async (req, res) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const row = await deps.prisma.routine.create({ data: parsed.data });
    await rescheduleRoutine(row.id, runnerDeps);
    res.json(rowToOut({ ...row, _count: { runs: 0 } }));
  });

  r.patch('/routines/:id', auth, async (req, res) => {
    const parsed = Body.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const row = await deps.prisma.routine.update({
      where: { id: req.params.id! },
      data: parsed.data,
      include: { _count: { select: { runs: true } } },
    });
    await rescheduleRoutine(row.id, runnerDeps);
    res.json(rowToOut(row));
  });

  r.delete('/routines/:id', auth, async (req, res) => {
    unscheduleRoutine(req.params.id!);
    await deps.prisma.routine.delete({ where: { id: req.params.id! } });
    res.json({ ok: true });
  });

  r.post('/routines/:id/run', auth, async (req, res) => {
    res.json({ ok: true });
    void runOnce(req.params.id!, runnerDeps);
  });

  r.get('/routines/:id/runs', auth, async (req, res) => {
    const rows = await deps.prisma.routineRun.findMany({
      where: { routineId: req.params.id! },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ runs: rows });
  });

  r.get('/routines/runs/recent', auth, async (_req, res) => {
    const rows = await deps.prisma.routineRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 30,
      include: { routine: { select: { name: true } } },
    });
    res.json({
      runs: rows.map((row) => ({
        id: row.id,
        routineId: row.routineId,
        routineName: row.routine.name,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        status: row.status,
        result: row.result,
        errorMsg: row.errorMsg,
        durationMs: row.durationMs,
      })),
    });
  });

  return r;
}

interface RoutineRowLike {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  channel: string;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  _count?: { runs: number };
}

function rowToOut(r: RoutineRowLike) {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    schedule: r.schedule,
    enabled: r.enabled,
    channel: r.channel,
    model: r.model,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    runCount: r._count?.runs ?? 0,
  };
}
