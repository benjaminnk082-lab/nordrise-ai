import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../logger.js';
import type { ClaudeBridge } from '../../claudeBridge.js';
import type { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import { openSseStream, writeSseFrame, startHeartbeat } from './stream.js';

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
});

export interface MessageRouterDeps {
  mgr: ControlSessionManager;
  makeBridge: () => Pick<ClaudeBridge, 'invoke' | 'on'>;
  allowedTokens: readonly string[];
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
    const result = await bridge.invoke({
      message: prompt,
      sessionId: session.claudeSessionId,
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
