import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../../logger.js';
import type { ClaudeBridge } from '../../claudeBridge.js';
import type { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import { openSseStream, writeSseFrame, startHeartbeat } from './stream.js';

const ModelEnum = z.enum([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

const ConnectorKeysSchema = z.object({
  FIRECRAWL_API_KEY: z.string().min(1).max(512).optional(),
  GITHUB_PERSONAL_ACCESS_TOKEN: z.string().min(1).max(512).optional(),
});

const BodySchema = z.object({
  controlSessionId: z.string().nullable(),
  text: z.string().min(1).max(20_000),
  attachments: z
    .array(
      z.object({
        fileId: z.string(),
        workspacePath: z.string(),
        filename: z.string(),
      }),
    )
    .max(5)
    .optional(),
  model: ModelEnum.optional(),
  /**
   * Per-request MCP connector keys. Travel ephemerally with the message and
   * are forwarded into claude-code's spawn env where the MCP server config
   * (mcp-config/claude-settings.json) substitutes them. NEVER persisted.
   */
  connectorKeys: ConnectorKeysSchema.optional(),
});

export interface MessageRouterDeps {
  mgr: ControlSessionManager;
  makeBridge: () => Pick<ClaudeBridge, 'invoke' | 'on'>;
  allowedTokens: readonly string[];
  /**
   * Prisma is required so we can compose the per-thread system prompt
   * (ControlSession.systemPrompt) and the recent-reactions feedback
   * fragment that gets appended to the persona. The legacy `mgr` interface
   * doesn't expose either, so we read directly here.
   */
  prisma: PrismaClient;
}

/**
 * Build the optional per-thread system-prompt fragment that gets appended
 * after the persona via `--append-system-prompt`. Combines:
 *   1. ControlSession.systemPrompt (user-set, per thread)
 *   2. The last 10 reacted-to assistant messages, formatted as a feedback
 *      block. ONLY assistant content is included — the user is the one
 *      reacting, so their messages aren't being "rated".
 * Returns `undefined` when neither piece exists.
 */
export async function composeExtraSystemPrompt(
  prisma: PrismaClient,
  controlSessionId: string,
): Promise<string | undefined> {
  const [sessionRow, recentReactions] = await Promise.all([
    prisma.controlSession.findUnique({
      where: { id: controlSessionId },
      select: { systemPrompt: true },
    }),
    prisma.message.findMany({
      where: {
        controlSessionId,
        role: 'assistant',
        reaction: { isNot: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { reaction: true },
    }),
  ]);

  const parts: string[] = [];
  if (sessionRow?.systemPrompt && sessionRow.systemPrompt.trim()) {
    parts.push(sessionRow.systemPrompt.trim());
  }

  if (recentReactions.length > 0) {
    // Reverse so oldest-first reads naturally as "Sean said X, you reacted Y".
    const lines = [...recentReactions].reverse().map((m) => {
      const sym = m.reaction!.value === 'up' ? '👍' : '👎';
      // Trim assistant content to a one-line preview so the system prompt
      // doesn't balloon. 120 chars is enough to recognise the reply.
      const preview = m.content.replace(/\s+/g, ' ').trim().slice(0, 120);
      return `- ${sym} på Sean's svar: "${preview}…"`;
    });
    parts.push(
      [
        '## Nylige reaksjoner i denne tråden',
        ...lines,
        '',
        'Bruk disse som tilbakemelding: 👍 = fortsett denne stilen, ' +
          '👎 = endre tilnærming.',
      ].join('\n'),
    );
  }

  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

export function makeControlMessageRouter(deps: MessageRouterDeps): Router {
  const r = Router();
  r.post('/message', makeRequireControlToken(deps.allowedTokens), (req, res) => handle(req, res, deps));
  return r;
}

async function handle(req: Request, res: Response, deps: MessageRouterDeps): Promise<void> {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  let session;
  try {
    session = await deps.mgr.getOrCreate(body.controlSessionId);
  } catch (err) {
    res.status(404).json({ error: 'session_not_found' });
    return;
  }

  let prompt = body.text;
  if (body.attachments?.length) {
    const lines = body.attachments
      .map((a) => `[Vedlegg tilgjengelig: ${a.workspacePath}]`)
      .join('\n');
    prompt = `${body.text}\n\n${lines}`;
  }

  await deps.mgr.recordMessage({
    controlSessionId: session.id,
    role: 'user',
    content: body.text,
  });

  openSseStream(res);
  const stopHeartbeat = startHeartbeat(res);
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const bridge = deps.makeBridge();
  let assistantText = '';
  bridge.on('thinking', () => writeSseFrame(res, { event: 'thinking', data: { at: Date.now() } }));
  bridge.on('partial', (chunk) => {
    assistantText += chunk;
    writeSseFrame(res, { event: 'partial', data: { text: chunk } });
  });
  bridge.on('sessionId', (claudeSessionId) =>
    writeSseFrame(res, { event: 'session', data: { claudeSessionId, controlSessionId: session.id } }),
  );

  logger.info({ controlSessionId: session.id, hasAttachments: !!body.attachments?.length }, 'control.message.start');

  try {
    // Build the per-request env for the bridge. Only include keys that the
    // client actually sent. We never log them — see logger.ts redact paths.
    const env: Record<string, string> = {};
    if (body.connectorKeys?.FIRECRAWL_API_KEY) {
      env.FIRECRAWL_API_KEY = body.connectorKeys.FIRECRAWL_API_KEY;
    }
    if (body.connectorKeys?.GITHUB_PERSONAL_ACCESS_TOKEN) {
      env.GITHUB_PERSONAL_ACCESS_TOKEN = body.connectorKeys.GITHUB_PERSONAL_ACCESS_TOKEN;
    }

    // Compose the per-thread system-prompt extras (custom prompt + recent
    // reactions). This runs before bridge.invoke so the new context flows
    // to claude-code on the same call. Best-effort — if the lookup fails
    // we still send the message without the extras instead of crashing.
    let extraSystemPrompt: string | undefined;
    try {
      extraSystemPrompt = await composeExtraSystemPrompt(deps.prisma, session.id);
    } catch (err) {
      logger.warn({ err, controlSessionId: session.id }, 'extra system prompt compose failed');
    }

    const result = await bridge.invoke({
      message: prompt,
      sessionId: session.claudeSessionId,
      ...(body.model ? { model: body.model } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(extraSystemPrompt ? { extraSystemPrompt } : {}),
      signal: ac.signal,
    });

    if (result.rateLimited) {
      writeSseFrame(res, { event: 'error', data: { message: 'rate_limit', retryAfterMs: 60_000 } });
    } else if (result.isError) {
      writeSseFrame(res, {
        event: 'error',
        data: { message: result.errorMessage ?? 'bridge_error' },
      });
    } else {
      const finalText = result.text || assistantText;
      if (result.sessionId && result.sessionId !== session.claudeSessionId) {
        await deps.mgr.updateClaudeSessionId(session.id, result.sessionId);
      } else {
        await deps.mgr.touch(session.id);
      }
      await deps.mgr.recordMessage({
        controlSessionId: session.id,
        role: 'assistant',
        content: finalText,
        durationMs: result.durationMs,
      });
      writeSseFrame(res, {
        event: 'done',
        data: { durationMs: result.durationMs, costUsdInformational: result.costUsd, isError: false },
      });
    }
    logger.info({ controlSessionId: session.id, durationMs: result.durationMs, isError: result.isError }, 'control.message.done');
  } catch (err) {
    writeSseFrame(res, { event: 'error', data: { message: String((err as Error).message ?? 'bridge_crash') } });
    logger.error({ err, controlSessionId: session.id }, 'control.message.crash');
  } finally {
    stopHeartbeat();
    res.end();
  }
}
