import { Router, type Request, type Response } from 'express';
import { join } from 'node:path';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { ClaudeBridge } from '../../claudeBridge.js';
import type { ControlSessionManager } from '../../controlSessionManager.js';
import { makeRequireControlToken } from './auth.js';
import { openSseStream, writeSseFrame, startHeartbeat } from './stream.js';
import { retrieveContext } from './retrieval.js';

const ModelEnum = z.enum([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
]);

const PermissionModeEnum = z.enum(['auto', 'manual', 'custom']);

/**
 * Effective per-action permissions sent only when permissionMode === 'custom'.
 * Each value mirrors the renderer's PermissionMode union.
 */
const EffectivePermissionsSchema = z.object({
  vaultWrite: z.enum(['auto', 'ask', 'block']).optional(),
  telegramSend: z.enum(['auto', 'ask', 'block']).optional(),
  webSearch: z.enum(['auto', 'ask', 'block']).optional(),
  githubAccess: z.enum(['auto', 'ask', 'block']).optional(),
  shellExec: z.enum(['auto', 'ask', 'block']).optional(),
});

const ConnectorKeysSchema = z.object({
  FIRECRAWL_API_KEY: z.string().min(1).max(512).optional(),
  GITHUB_PERSONAL_ACCESS_TOKEN: z.string().min(1).max(512).optional(),
  VERCEL_TOKEN: z.string().min(1).max(512).optional(),
  MS365_MCP_OAUTH_REFRESH_TOKEN: z.string().min(1).max(4096).optional(),
  MS365_MCP_CLIENT_ID: z.string().min(1).max(128).optional(),
  MS365_MCP_TENANT_ID: z.string().min(1).max(128).optional(),
  ITSLEARNING_SITE: z.string().min(1).max(256).optional(),
  ITSLEARNING_CLIENT_ID: z.string().min(1).max(256).optional(),
  ITSLEARNING_CLIENT_SECRET: z.string().min(1).max(512).optional(),
  ITSLEARNING_REFRESH_TOKEN: z.string().min(1).max(2048).optional(),
  VISMA_SCHOOL: z.string().min(1).max(256).optional(),
  VISMA_COOKIE: z.string().min(1).max(4096).optional(),
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
  /**
   * Per-user Claude OAuth token (e.g. `sk-ant-oat01-…`). Travels ephemerally
   * with the message and is forwarded into claude-code's spawn env as
   * `CLAUDE_CODE_OAUTH_TOKEN`, overriding the server-default token for that
   * subprocess. Never persisted backend-side. When absent, claude-code uses
   * the server's default token (inherited from `process.env`).
   */
  claudeAuthToken: z.string().min(20).max(500).optional(),
  /**
   * v0.5.2 — three-way permission mode (Claude Code-style). When set, the
   * backend appends a system-prompt fragment that instructs Sean how strict
   * to be about confirming actions. `manual` makes Sean ask before every
   * mutating action; `auto` is the default (no extra confirmation); `custom`
   * uses `effectivePermissions` for per-action granularity.
   */
  permissionMode: PermissionModeEnum.optional(),
  /** Per-action permissions; only honored when `permissionMode === 'custom'`. */
  effectivePermissions: EffectivePermissionsSchema.optional(),
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
  /**
   * Optional factory for the per-message retrieval bridge (Haiku keyword
   * pass). Defaults to a fresh `ClaudeBridge`. Tests pass a stub that
   * returns canned keyword JSON to avoid spawning `claude`.
   */
  makeRetrievalBridge?: () => Pick<ClaudeBridge, 'invoke'>;
}

/**
 * Build the permission-policy fragment from a request body's permissionMode
 * and effectivePermissions. Returns `undefined` for the implicit-auto case
 * (mode missing or 'auto') so we don't bloat every request with a no-op
 * fragment.
 *
 * `manual` produces a single emphatic instruction. `custom` produces a
 * concrete list keyed by action so Sean knows which classes need a confirm.
 */
export function buildPermissionFragment(
  mode: 'auto' | 'manual' | 'custom' | undefined,
  perAction: {
    vaultWrite?: 'auto' | 'ask' | 'block';
    telegramSend?: 'auto' | 'ask' | 'block';
    webSearch?: 'auto' | 'ask' | 'block';
    githubAccess?: 'auto' | 'ask' | 'block';
    shellExec?: 'auto' | 'ask' | 'block';
  } | undefined,
): string | undefined {
  if (!mode || mode === 'auto') return undefined;

  if (mode === 'manual') {
    return [
      '## Permissions (manual mode)',
      '',
      'Brukeren har slått PÅ manuell-modus. Du må be om eksplisitt bekreftelse',
      'FØR du utfører noen handling som muterer state — uavhengig av hva',
      'som ellers står i denne prompten. Det inkluderer (men er ikke',
      'begrenset til): skrive til vault/sean-notes, sende meldinger,',
      'bygge/deploye, kjøre shell, kalle eksterne API-er som endrer data,',
      'opprette filer, bruke connectors. Lese-handlinger (`ls`, grep, fetch',
      'av offentlig info) går fortsatt gjennom uten å spørre.',
      '',
      'Format på bekreftelse: ett konkret ja/nei-spørsmål som beskriver',
      'handlingen ("Skal jeg sende denne meldingen i Teams?"). Vent på',
      '"ja"/"yes"/"kjør" før du fortsetter.',
    ].join('\n');
  }

  // mode === 'custom' — emit concrete per-action policy.
  const labels: Record<keyof NonNullable<typeof perAction>, string> = {
    vaultWrite: 'skrive til vault / sean-notes',
    telegramSend: 'sende Telegram-meldinger',
    webSearch: 'web-søk og scrape (Firecrawl/curl)',
    githubAccess: 'GitHub-API-kall (issues, PRs, kode)',
    shellExec: 'shell-kommandoer (Bash, npm, git ...)',
  };
  const lines: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const v = perAction?.[key as keyof typeof labels];
    if (!v) continue;
    if (v === 'auto') lines.push(`- ${label}: utfør uten å spørre`);
    if (v === 'ask') lines.push(`- ${label}: spør først, vent på bekreftelse`);
    if (v === 'block') lines.push(`- ${label}: blokkert — ikke gjør, si til brukeren at det er av`);
  }
  if (lines.length === 0) return undefined;
  return [
    '## Permissions (custom mode)',
    '',
    'Brukeren har satt finkornede regler for hvilke handlinger som skal',
    'utføres direkte vs. bekreftes. Følg listen under nøye:',
    '',
    ...lines,
    '',
    'For handlinger som ikke står i listen: bruk vanlig dømmekraft (lese-',
    'handlinger fritt; muterende handlinger be om bekreftelse).',
  ].join('\n');
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

  // When the deployment is locked to per-user tokens (shared instances), refuse
  // anonymous traffic up-front so it never reaches the bridge / consumes quota.
  if (config.REQUIRE_USER_CLAUDE_TOKEN && !body.claudeAuthToken) {
    res.status(402).json({ error: 'user_token_required' });
    return;
  }

  let session;
  try {
    session = await deps.mgr.getOrCreate(body.controlSessionId);
  } catch (err) {
    res.status(404).json({ error: 'session_not_found' });
    return;
  }

  // Obsidian-as-brain: when this is the very first message of a thread
  // (no claudeSessionId yet), inject a tiny system-style priming note that
  // tells Sean to load his vault memory before answering. Persona explains
  // the contract; this just guarantees the read happens up-front instead
  // of silently being skipped.
  let priming = '';
  if (!session.claudeSessionId) {
    priming =
      '[System: Dette er en ny samtale. Les vault/Sean/MEMORY.md først (hvis finnes) for å frem-laste konteksten din.]\n\n';
  }

  let prompt = priming + body.text;
  if (body.attachments?.length) {
    const lines = body.attachments
      .map((a) => `[Vedlegg tilgjengelig: ${a.workspacePath}]`)
      .join('\n');
    prompt = `${priming}${body.text}\n\n${lines}`;
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
    if (body.connectorKeys?.VERCEL_TOKEN) {
      env.VERCEL_TOKEN = body.connectorKeys.VERCEL_TOKEN;
    }
    if (body.connectorKeys?.MS365_MCP_OAUTH_REFRESH_TOKEN) {
      env.MS365_MCP_OAUTH_REFRESH_TOKEN = body.connectorKeys.MS365_MCP_OAUTH_REFRESH_TOKEN;
    }
    if (body.connectorKeys?.MS365_MCP_CLIENT_ID) {
      env.MS365_MCP_CLIENT_ID = body.connectorKeys.MS365_MCP_CLIENT_ID;
    }
    if (body.connectorKeys?.MS365_MCP_TENANT_ID) {
      env.MS365_MCP_TENANT_ID = body.connectorKeys.MS365_MCP_TENANT_ID;
    }
    if (body.connectorKeys?.ITSLEARNING_SITE) {
      env.ITSLEARNING_SITE = body.connectorKeys.ITSLEARNING_SITE;
    }
    if (body.connectorKeys?.ITSLEARNING_CLIENT_ID) {
      env.ITSLEARNING_CLIENT_ID = body.connectorKeys.ITSLEARNING_CLIENT_ID;
    }
    if (body.connectorKeys?.ITSLEARNING_CLIENT_SECRET) {
      env.ITSLEARNING_CLIENT_SECRET = body.connectorKeys.ITSLEARNING_CLIENT_SECRET;
    }
    if (body.connectorKeys?.ITSLEARNING_REFRESH_TOKEN) {
      env.ITSLEARNING_REFRESH_TOKEN = body.connectorKeys.ITSLEARNING_REFRESH_TOKEN;
    }
    if (body.connectorKeys?.VISMA_SCHOOL) {
      env.VISMA_SCHOOL = body.connectorKeys.VISMA_SCHOOL;
    }
    if (body.connectorKeys?.VISMA_COOKIE) {
      env.VISMA_COOKIE = body.connectorKeys.VISMA_COOKIE;
    }
    // Per-user Claude OAuth token overrides the server's default for this
    // subprocess. Spread order in the bridge ensures opts.env wins over
    // sanitizedEnv() (which carries process.env's CLAUDE_CODE_OAUTH_TOKEN).
    if (body.claudeAuthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = body.claudeAuthToken;
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

    // Active retrieval — fire-and-forget per spec. Best-effort: any failure
    // here returns '' so the message proceeds without retrieved context.
    // Uses a fresh bridge with model=Haiku for a tiny keyword extraction call.
    let retrievedContext = '';
    try {
      const vaultDir = join(config.WORKSPACE_DIR, 'vault');
      const retrievalBridge = deps.makeRetrievalBridge
        ? deps.makeRetrievalBridge()
        : new ClaudeBridge();
      retrievedContext = await retrieveContext({
        vaultDir,
        message: body.text,
        bridge: retrievalBridge,
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'retrieval crashed (continuing)');
    }

    // Permission policy fragment — only emitted for 'manual'/'custom'.
    // Auto-mode is the implicit default and produces no extra prompt.
    const permissionFragment = buildPermissionFragment(
      body.permissionMode,
      body.effectivePermissions,
    );

    const finalExtra = [extraSystemPrompt, retrievedContext, permissionFragment]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s) => s.length > 0)
      .join('\n\n---\n\n');

    const result = await bridge.invoke({
      message: prompt,
      sessionId: session.claudeSessionId,
      ...(body.model ? { model: body.model } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(finalExtra ? { extraSystemPrompt: finalExtra } : {}),
      // Self-critique pass: when reply is long (>500 chars), run a Haiku
      // critique to refine. Defaults to true — short replies are unaffected.
      selfCritique: true,
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
      // Phase 3 — persist token usage. Best-effort: a DB write failure
      // never prevents the user-facing `done` frame from going out.
      // Project association is inherited from the ControlSession row
      // (set via PATCH /control/sessions/:id/project). We re-read here
      // because the renderer may have changed the assignment mid-stream.
      try {
        const sessRow = await deps.prisma.controlSession.findUnique({
          where: { id: session.id },
          select: { projectId: true },
        });
        await deps.prisma.tokenUsage.create({
          data: {
            controlSessionId: session.id,
            projectId: sessRow?.projectId ?? null,
            inputTokens: result.inputTokens ?? 0,
            outputTokens: result.outputTokens ?? 0,
            cacheReadTokens: result.cacheReadTokens ?? 0,
            cacheCreationTokens: result.cacheCreationTokens ?? 0,
            costUsd: result.costUsd ?? 0,
            modelId: result.modelId ?? body.model ?? null,
            durationMs: result.durationMs,
          },
        });
      } catch (err) {
        logger.warn({ err, controlSessionId: session.id }, 'tokenUsage persist failed');
      }
      writeSseFrame(res, {
        event: 'done',
        data: {
          durationMs: result.durationMs,
          costUsdInformational: result.costUsd,
          isError: false,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? 0,
          modelId: result.modelId ?? body.model ?? null,
        },
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
