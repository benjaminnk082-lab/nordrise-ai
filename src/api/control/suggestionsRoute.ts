/**
 * suggestionsRoute.ts — REST API for the Suggestion queue.
 *
 * Mounted under /control. All endpoints are gated by the same bearer-token
 * middleware as the rest of the control plane. /approve schedules a
 * fire-and-forget execution; the desktop app polls list to observe the
 * status transition pending → approved → done|failed.
 */

import { Router } from 'express';
import type { PrismaClient, Suggestion } from '@prisma/client';
import { makeRequireControlToken } from './auth.js';
import { executeApproved, generateOnce } from './suggestionsGenerator.js';

export interface SuggestionsRouterDeps {
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

export function makeSuggestionsRouter(deps: SuggestionsRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/suggestions', auth, async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const where = status ? { status } : {};
    const rows = await deps.prisma.suggestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ suggestions: rows.map(toSummary) });
  });

  r.post('/suggestions/:id/approve', auth, async (req, res) => {
    const id = req.params.id!;
    try {
      const s = await deps.prisma.suggestion.update({
        where: { id },
        data: { status: 'approved', decidedAt: new Date() },
      });
      res.json(toSummary(s));
      // Fire-and-forget — handler awaits its own DB writes.
      void executeApproved(deps.prisma, id);
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  r.post('/suggestions/:id/reject', auth, async (req, res) => {
    try {
      const s = await deps.prisma.suggestion.update({
        where: { id: req.params.id! },
        data: { status: 'rejected', decidedAt: new Date() },
      });
      res.json(toSummary(s));
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  r.delete('/suggestions/:id', auth, async (req, res) => {
    try {
      await deps.prisma.suggestion.delete({ where: { id: req.params.id! } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  r.post('/suggestions/generate-now', auth, async (_req, res) => {
    const result = await generateOnce({ prisma: deps.prisma, config: {} });
    res.json(result);
  });

  return r;
}

function toSummary(s: Suggestion) {
  return {
    id: s.id,
    type: s.type,
    title: s.title,
    rationale: s.rationale,
    prompt: s.prompt,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    decidedAt: s.decidedAt?.toISOString() ?? null,
    executedAt: s.executedAt?.toISOString() ?? null,
    result: s.result,
    errorMsg: s.errorMsg,
    durationMs: s.durationMs,
  };
}
