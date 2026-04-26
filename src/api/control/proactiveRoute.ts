/**
 * proactiveRoute.ts — REST API for the proactive engine.
 *
 * Mounted under /control. Exposes:
 *   GET    /control/proactive/settings   — current ProactiveSettings row
 *   PATCH  /control/proactive/settings   — update enabled/quiet/cap fields
 *   GET    /control/proactive/attempts   — last 100 attempts (newest first)
 *   POST   /control/proactive/run-now    — manual trigger (still respects
 *                                           every guardrail in runOnce)
 *
 * All endpoints share the bearer-token middleware used by the rest of the
 * control plane.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { makeRequireControlToken } from './auth.js';
import { runOnce, type ProactiveDeps } from './proactiveEngine.js';

export interface ProactiveRouterDeps {
  prisma: PrismaClient;
  engineDeps: ProactiveDeps;
  allowedTokens: readonly string[];
}

const PatchBody = z.object({
  enabled: z.boolean().optional(),
  quietHourStart: z.number().int().min(0).max(23).optional(),
  quietHourEnd: z.number().int().min(0).max(23).optional(),
  maxPerHour: z.number().int().min(0).max(20).optional(),
  maxPerDay: z.number().int().min(0).max(50).optional(),
  cadenceMin: z.number().int().min(5).max(120).optional(),
});

export function makeProactiveRouter(deps: ProactiveRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/proactive/settings', auth, async (_req, res) => {
    let s = await deps.prisma.proactiveSettings.findFirst();
    if (!s) s = await deps.prisma.proactiveSettings.create({ data: {} });
    res.json(s);
  });

  r.patch('/proactive/settings', auth, async (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    let existing = await deps.prisma.proactiveSettings.findFirst();
    if (!existing) {
      existing = await deps.prisma.proactiveSettings.create({ data: {} });
    }
    const updated = await deps.prisma.proactiveSettings.update({
      where: { id: existing.id },
      data: parsed.data,
    });
    res.json(updated);
  });

  r.get('/proactive/attempts', auth, async (_req, res) => {
    const rows = await deps.prisma.proactiveAttempt.findMany({
      orderBy: { triggeredAt: 'desc' },
      take: 100,
    });
    res.json({ attempts: rows });
  });

  r.post('/proactive/run-now', auth, async (_req, res) => {
    const result = await runOnce(deps.engineDeps);
    res.json(result);
  });

  return r;
}
