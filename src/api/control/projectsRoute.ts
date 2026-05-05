/**
 * projectsRoute — Phase 3 endpoints for Project + TokenUsage models.
 *
 * Mounted under `/control/` by `gateway.ts`. All routes are gated by
 * the existing `makeRequireControlToken` middleware (DO NOT BREAK §6.4).
 *
 * Endpoints
 *   GET    /control/projects                      list all
 *   POST   /control/projects                      create { name, description? }
 *   PATCH  /control/sessions/:id/project          assign { projectId | null }
 *   GET    /control/usage?since=<ISO>             aggregated summary
 *   GET    /control/usage.csv?since=<ISO>         same data, CSV
 *
 * Token usage is written by `messageRoute.ts` after every successful
 * stream — no client-side recording needed.
 */
import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { makeRequireControlToken } from './auth.js';
import { logger } from '../../logger.js';

export interface ProjectsRouterDeps {
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

const AssignProjectSchema = z.object({
  projectId: z.string().nullable(),
});

export function makeProjectsRouter(deps: ProjectsRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/projects', auth, async (_req, res) => {
    const projects = await deps.prisma.project.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  r.post('/projects', auth, async (req, res) => {
    const parsed = ProjectCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    try {
      const created = await deps.prisma.project.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description ?? null,
        },
      });
      res.status(201).json({
        id: created.id,
        name: created.name,
        description: created.description,
        createdAt: created.createdAt.toISOString(),
      });
    } catch (err) {
      logger.warn({ err }, 'project create failed');
      res.status(409).json({ error: 'project_create_failed' });
    }
  });

  r.patch('/sessions/:id/project', auth, async (req: Request, res: Response) => {
    const parsed = AssignProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    try {
      await deps.prisma.controlSession.update({
        where: { id: req.params.id },
        data: { projectId: parsed.data.projectId },
      });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ error: 'session_not_found' });
    }
  });

  r.get('/usage', auth, async (req, res) => {
    const since = parseSince(req.query.since);
    const rows = await deps.prisma.tokenUsage.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
    });
    const projects = await deps.prisma.project.findMany();
    const projMap = new Map(projects.map((p) => [p.id, p.name] as const));

    let totalIn = 0;
    let totalOut = 0;
    let totalCost = 0;
    const byProject = new Map<
      string | null,
      {
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        sessions: Set<string>;
      }
    >();
    const byDay = new Map<
      string,
      { inputTokens: number; outputTokens: number; costUsd: number }
    >();

    for (const row of rows) {
      totalIn += row.inputTokens;
      totalOut += row.outputTokens;
      totalCost += row.costUsd;

      const pkey = row.projectId ?? null;
      const slot =
        byProject.get(pkey) ??
        { inputTokens: 0, outputTokens: 0, costUsd: 0, sessions: new Set<string>() };
      slot.inputTokens += row.inputTokens;
      slot.outputTokens += row.outputTokens;
      slot.costUsd += row.costUsd;
      if (row.controlSessionId) slot.sessions.add(row.controlSessionId);
      byProject.set(pkey, slot);

      const day = row.recordedAt.toISOString().slice(0, 10);
      const dslot =
        byDay.get(day) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      dslot.inputTokens += row.inputTokens;
      dslot.outputTokens += row.outputTokens;
      dslot.costUsd += row.costUsd;
      byDay.set(day, dslot);
    }

    res.json({
      since: since.toISOString(),
      total: { inputTokens: totalIn, outputTokens: totalOut, costUsd: totalCost },
      byProject: [...byProject.entries()].map(([projectId, v]) => ({
        projectId,
        projectName: projectId ? (projMap.get(projectId) ?? null) : null,
        inputTokens: v.inputTokens,
        outputTokens: v.outputTokens,
        costUsd: v.costUsd,
        sessionCount: v.sessions.size,
      })),
      byDay: [...byDay.entries()]
        .sort()
        .map(([date, v]) => ({ date, ...v })),
    });
  });

  r.get('/usage.csv', auth, async (req, res) => {
    const since = parseSince(req.query.since);
    const rows = await deps.prisma.tokenUsage.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
      include: { project: true },
    });
    const lines = [
      'recordedAt,modelId,projectId,projectName,sessionId,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,costUsd,durationMs',
    ];
    for (const r of rows) {
      lines.push(
        [
          r.recordedAt.toISOString(),
          r.modelId ?? '',
          r.projectId ?? '',
          r.project?.name ?? '',
          r.controlSessionId ?? '',
          r.inputTokens,
          r.outputTokens,
          r.cacheReadTokens,
          r.cacheCreationTokens,
          r.costUsd.toFixed(6),
          r.durationMs ?? '',
        ].join(','),
      );
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nordrise-usage-${since.toISOString().slice(0, 10)}.csv"`,
    );
    res.send(lines.join('\n'));
  });

  return r;
}

function parseSince(raw: unknown): Date {
  if (typeof raw === 'string') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Default: last 30 days.
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}
