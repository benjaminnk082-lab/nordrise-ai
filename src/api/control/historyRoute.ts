import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { makeRequireControlToken } from './auth.js';
import type { ControlMessageRow } from './types.js';

const Query = z.object({
  source: z.enum(['telegram', 'desktop', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().datetime().optional(),
});

export interface HistoryRouterDeps {
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

export function makeControlHistoryRouter(deps: HistoryRouterDeps): Router {
  const r = Router();
  r.get('/history', makeRequireControlToken(deps.allowedTokens), async (req, res) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_query' });
      return;
    }
    const { source, limit, before } = parsed.data;
    const where: any = {};
    if (source === 'telegram') where.sessionId = { not: null };
    if (source === 'desktop') where.controlSessionId = { not: null };
    if (before) where.createdAt = { lt: new Date(before) };

    const rows = await deps.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { reaction: true },
    });
    const messages: ControlMessageRow[] = rows.map((m) => ({
      id: m.id,
      role: m.role as ControlMessageRow['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      durationMs: m.durationMs,
      source: m.sessionId ? 'telegram' : 'desktop',
      reaction: m.reaction
        ? (m.reaction.value as 'up' | 'down')
        : null,
    }));
    res.json({ messages });
  });
  return r;
}
