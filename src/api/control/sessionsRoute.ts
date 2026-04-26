import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import type { ControlSessionSummary, ControlMessageRow } from './types.js';

const RenameBody = z.object({ title: z.string().min(1).max(120) });
const MessageBody = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(40_000),
  // Informational only — model isn't persisted yet (no column), but we
  // accept it so the renderer can send it without breakage.
  model: z.string().optional(),
});

export interface SessionsRouterDeps {
  mgr: ControlSessionManager;
  prisma: PrismaClient;
  allowedTokens: readonly string[];
}

export function makeControlSessionsRouter(deps: SessionsRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);

  r.get('/sessions', auth, async (_req, res) => {
    const rows = await deps.mgr.list();
    const sessions: ControlSessionSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      claudeSessionId: row.claudeSessionId,
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
    res.json({ sessions });
  });

  r.post('/session/new', auth, async (_req, res) => {
    const s = await deps.mgr.getOrCreate(null);
    const row = await deps.prisma.controlSession.findUnique({ where: { id: s.id } });
    res.json({
      id: row!.id,
      title: row!.title,
      claudeSessionId: row!.claudeSessionId,
      createdAt: row!.createdAt.toISOString(),
      lastActiveAt: row!.lastActiveAt.toISOString(),
      archivedAt: null,
    });
  });

  r.patch('/sessions/:id', auth, async (req, res) => {
    const parsed = RenameBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    await deps.mgr.rename(req.params.id!, parsed.data.title);
    res.json({ ok: true });
  });

  r.post('/sessions/:id/archive', auth, async (req, res) => {
    await deps.mgr.archive(req.params.id!);
    res.json({ ok: true });
  });

  // Manual message-persistence — used by the desktop app when a thread is
  // routed through Ollama (bypassing Sean) so the conversation still
  // ends up in the same DB and can be queried alongside Sean's history.
  r.post('/sessions/:id/messages', auth, async (req, res) => {
    const parsed = MessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    // Verify the session exists so we don't silently leak orphan rows.
    const exists = await deps.prisma.controlSession.findUnique({
      where: { id: req.params.id! },
    });
    if (!exists) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    await deps.prisma.message.create({
      data: {
        controlSessionId: req.params.id!,
        role: parsed.data.role,
        content: parsed.data.content,
      },
    });
    await deps.mgr.touch(req.params.id!);
    res.json({ ok: true });
  });

  r.get('/sessions/:id/messages', auth, async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : null;
    const messages = await deps.prisma.message.findMany({
      where: {
        controlSessionId: req.params.id!,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const out: ControlMessageRow[] = messages.map((m) => ({
      id: m.id,
      role: m.role as ControlMessageRow['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      durationMs: m.durationMs,
      source: 'desktop',
    }));
    res.json({ messages: out });
  });

  return r;
}
