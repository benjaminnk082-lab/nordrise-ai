/**
 * appImprovementRoute.ts — REST API for the AppImprovement queue.
 *
 *   GET    /control/app-improvements             — list rows (newest first)
 *   POST   /control/app-improvements/scan-now    — manually trigger watcher
 *   POST   /control/app-improvements/:id/approve — approve + kick off spec
 *                                                  generation (background)
 *   POST   /control/app-improvements/:id/reject  — mark rejected
 *   DELETE /control/app-improvements/:id         — drop the row
 *
 * All endpoints are bearer-token gated like the rest of /control. Spec
 * generation is fire-and-forget; the desktop app polls list to observe the
 * status transition pending → approved → spec-written.
 */

import { Router } from 'express';
import type { PrismaClient, AppImprovement } from '@prisma/client';
import { makeRequireControlToken } from './auth.js';
import { scanOnce, type AppImprovementWatcherDeps } from './appImprovementWatcher.js';
import { generateSpec, type GenerateSpecDeps } from './appImprovementSpec.js';

export interface AppImprovementRouterDeps {
  prisma: PrismaClient;
  /** Absolute path to the seanNotes root, e.g. /app/workspace/sean-notes. */
  seanNotesDir: string;
  allowedTokens: readonly string[];
  /** Test seam — by default uses a fresh ClaudeBridge inside scan/spec. */
  watcherDeps?: Partial<AppImprovementWatcherDeps>;
  specDeps?: Partial<GenerateSpecDeps>;
}

export function makeAppImprovementRouter(
  deps: AppImprovementRouterDeps,
): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/app-improvements', auth, async (_req, res) => {
    const rows = await deps.prisma.appImprovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ improvements: rows.map(toSummary) });
  });

  r.post('/app-improvements/scan-now', auth, async (_req, res) => {
    const result = await scanOnce({
      prisma: deps.prisma,
      ...(deps.watcherDeps ?? {}),
    });
    res.json(result);
  });

  r.post('/app-improvements/:id/approve', auth, async (req, res) => {
    const id = req.params.id!;
    let row: AppImprovement;
    try {
      row = await deps.prisma.appImprovement.update({
        where: { id },
        data: { status: 'approved', approvedAt: new Date() },
      });
    } catch {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(toSummary(row));
    // Fire-and-forget. The handler always finishes — failures are logged
    // and the row stays at status='approved' until the next manual retry.
    void generateSpec(
      {
        prisma: deps.prisma,
        seanNotesDir: deps.seanNotesDir,
        ...(deps.specDeps ?? {}),
      },
      id,
    );
  });

  r.post('/app-improvements/:id/reject', auth, async (req, res) => {
    try {
      const row = await deps.prisma.appImprovement.update({
        where: { id: req.params.id! },
        data: { status: 'rejected' },
      });
      res.json(toSummary(row));
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  r.delete('/app-improvements/:id', auth, async (req, res) => {
    try {
      await deps.prisma.appImprovement.delete({ where: { id: req.params.id! } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'not_found' });
    }
  });

  return r;
}

function toSummary(s: AppImprovement) {
  return {
    id: s.id,
    category: s.category,
    title: s.title,
    description: s.description,
    rationale: s.rationale,
    patternEvidence: s.patternEvidence,
    proposedSpec: s.proposedSpec,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    approvedAt: s.approvedAt?.toISOString() ?? null,
    specWrittenAt: s.specWrittenAt?.toISOString() ?? null,
    vaultPath: s.vaultPath,
  };
}
