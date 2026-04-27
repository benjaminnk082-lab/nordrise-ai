import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import type {
  ControlSessionSummary,
  ControlMessageRow,
  PinnedMessage,
} from './types.js';

const PatchSessionBody = z
  .object({
    title: z.string().min(1).max(120).optional(),
    // `null` clears the per-thread prompt and falls back to the persona;
    // an empty string is also treated as "clear".
    systemPrompt: z.string().max(5000).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.systemPrompt !== undefined, {
    message: 'must include title and/or systemPrompt',
  });
const MessageBody = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(40_000),
  // Informational only — model isn't persisted yet (no column), but we
  // accept it so the renderer can send it without breakage.
  model: z.string().optional(),
});
const ReactionBody = z.object({ value: z.enum(['up', 'down']) });

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
      systemPrompt: row.systemPrompt ?? null,
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
      systemPrompt: row!.systemPrompt ?? null,
    });
  });

  r.patch('/sessions/:id', auth, async (req, res) => {
    const parsed = PatchSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const data: { title?: string; systemPrompt?: string | null } = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.systemPrompt !== undefined) {
      // Treat empty / whitespace-only as a clear, so the renderer's "Slett"
      // button can simply send "" without us having to special-case null
      // there too.
      const v = parsed.data.systemPrompt;
      data.systemPrompt =
        v === null || v.trim().length === 0 ? null : v;
    }
    try {
      await deps.prisma.controlSession.update({
        where: { id: req.params.id! },
        data,
      });
    } catch {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
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
      include: { reaction: true },
    });
    const out: ControlMessageRow[] = messages.map((m) => ({
      id: m.id,
      role: m.role as ControlMessageRow['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      durationMs: m.durationMs,
      source: 'desktop',
      reaction: m.reaction
        ? (m.reaction.value as 'up' | 'down')
        : null,
      pinned: m.pinned ?? false,
      controlSessionId: m.controlSessionId ?? null,
    }));
    res.json({ messages: out });
  });

  // Reactions on a message — one reaction per message; POST is upsert,
  // DELETE is idempotent. The renderer uses these to provide 👍/👎 feedback
  // on Sean's responses; messageRoute reads the recent reactions in this
  // session and passes them as feedback context to the next claude-code
  // invocation (see composeExtraSystemPrompt).
  r.post('/messages/:messageId/reaction', auth, async (req, res) => {
    const parsed = ReactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const messageId = req.params.messageId!;
    // Validate the message exists so we don't create reactions for ghost
    // messages (Cascade-on-delete still cleans up if it goes away later).
    const exists = await deps.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true },
    });
    if (!exists) {
      res.status(404).json({ error: 'message_not_found' });
      return;
    }
    await deps.prisma.reaction.upsert({
      where: { messageId },
      create: { messageId, value: parsed.data.value },
      update: { value: parsed.data.value },
    });
    res.json({ ok: true });
  });

  r.delete('/messages/:messageId/reaction', auth, async (req, res) => {
    try {
      await deps.prisma.reaction.delete({
        where: { messageId: req.params.messageId! },
      });
    } catch {
      // Idempotent — already gone is success.
    }
    res.json({ ok: true });
  });

  // Pin / unpin a message. Toggle semantics — current value is read first,
  // then flipped. Returns the new pinned state so the renderer can keep
  // optimistic UI in sync without an extra GET.
  r.post('/messages/:id/pin', auth, async (req, res) => {
    const m = await deps.prisma.message.findUnique({
      where: { id: req.params.id! },
      select: { id: true, pinned: true },
    });
    if (!m) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const next = !(m.pinned ?? false);
    await deps.prisma.message.update({
      where: { id: m.id },
      data: { pinned: next },
    });
    res.json({ ok: true, pinned: next });
  });

  // Confidence calibration — aggregates reactions on assistant messages,
  // bucketed by Sean's confidence tag (parsed from the trailing marker):
  //   no marker  → 'certain'
  //   `[~]`      → 'likely'
  //   `[?]`      → 'uncertain'
  // The desktop app surfaces these as a calibration sub-block in Settings.
  r.get('/calibration', auth, async (_req, res) => {
    const reacted = await deps.prisma.message.findMany({
      where: { reaction: { isNot: null }, role: 'assistant' },
      include: { reaction: true },
    });
    const buckets = {
      certain: { up: 0, down: 0 },
      likely: { up: 0, down: 0 },
      uncertain: { up: 0, down: 0 },
    };
    for (const m of reacted) {
      const trail = m.content.trim();
      let bucket: 'certain' | 'likely' | 'uncertain' = 'certain';
      if (/\[\?\]\s*$/.test(trail)) bucket = 'uncertain';
      else if (/\[~\]\s*$/.test(trail)) bucket = 'likely';
      if (m.reaction!.value === 'up') buckets[bucket].up++;
      else buckets[bucket].down++;
    }
    res.json({ buckets, total: reacted.length });
  });

  // Pinned-message index — flat list across all sessions, newest first.
  // Cap at 100 so the side panel doesn't have to virtualise. Includes the
  // owning thread title so the renderer can group by thread.
  r.get('/messages/pinned', auth, async (_req, res) => {
    const rows = await deps.prisma.message.findMany({
      where: { pinned: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { controlSession: { select: { title: true } } },
    });
    const pinned: PinnedMessage[] = rows.map((m) => ({
      id: m.id,
      controlSessionId: m.controlSessionId ?? null,
      sessionTitle: m.controlSession?.title ?? null,
      role: m.role as PinnedMessage['role'],
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));
    res.json({ pinned });
  });

  return r;
}
