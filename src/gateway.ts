/**
 * gateway.ts — Express entrypoint.
 *
 * Telegram webhook + /control routes. Healthcheck. Graceful shutdown.
 */

import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { join } from 'node:path';
import { config, controlTokens } from './config.js';
import { logger } from './logger.js';
import { handleUpdate, initTelegramBot, bot } from './channels/telegram.js';
import { prisma } from './db.js';
import { ClaudeBridge } from './claudeBridge.js';
import { controlSessionManager } from './controlSessionManager.js';
import { makeControlMessageRouter } from './api/control/messageRoute.js';
import { makeControlSessionsRouter } from './api/control/sessionsRoute.js';
import { makeControlHistoryRouter } from './api/control/historyRoute.js';
import { makeControlUploadRouter } from './api/control/uploadRoute.js';
import { makeVaultRouter } from './api/control/vaultRoute.js';
import { makeRoutinesRouter } from './api/control/routinesRoute.js';
import { startRoutinesRunner } from './api/control/routinesRunner.js';
import { makeSuggestionsRouter } from './api/control/suggestionsRoute.js';
import { makeControlPersonaRouter } from './api/control/personaRoute.js';
import {
  startSuggestionsGenerator,
  stopSuggestionsGenerator,
  startExpirationSweep,
} from './api/control/suggestionsGenerator.js';
import { startInboxCleanupInterval } from './api/control/inboxCleanup.js';

const app = express();

app.use(
  express.json({
    limit: '1mb',
    // Telegram payloads are JSON; reject anything else fast.
    verify: (_req, _res, buf) => {
      if (!buf || buf.length === 0) throw new Error('empty body');
    },
  }),
);

app.get('/healthz', async (_req, res) => {
  let db: 'ok' | 'error' = 'ok';
  let recentMessageCount: number | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  if (db === 'ok') {
    try {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      recentMessageCount = await prisma.message.count({
        where: { createdAt: { gt: fiveHoursAgo } },
      });
    } catch {
      // Non-fatal — leave recentMessageCount=null and let the renderer
      // gracefully say "ukjent".
      recentMessageCount = null;
    }
  }
  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    authMode: 'subscription',
    db,
    uptimeSec: Math.floor(process.uptime()),
    recentMessageCount,
    service: 'nordrise-ai',
  });
});

app.post('/telegram', async (req: Request, res: Response) => {
  const secret = req.header('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
    logger.warn({ ip: req.ip }, 'telegram webhook with bad/missing secret');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Respond immediately so Telegram doesn't retry while Sean is thinking.
  res.status(200).json({ ok: true });

  try {
    await handleUpdate(req.body);
  } catch (err) {
    logger.error({ err }, 'telegram update handler crashed');
  }
});

// /control/* — desktop control plane.
// Each sub-router carries its own auth middleware via makeRequireControlToken.
// uploadRoute's local error handler (LIMIT_FILE_SIZE -> 413) is registered on
// the upload sub-router itself, so it's scoped to upload errors only and won't
// catch errors from the other routers.
const inboxDir = join(config.WORKSPACE_DIR, 'inbox');
const vaultDir = join(config.WORKSPACE_DIR, 'vault');
const seanNotesDir = join(config.WORKSPACE_DIR, 'sean-notes');
mkdirSync(inboxDir, { recursive: true });
mkdirSync(vaultDir, { recursive: true });
mkdirSync(seanNotesDir, { recursive: true });

const controlRouter = Router();
controlRouter.use(
  makeControlMessageRouter({
    mgr: controlSessionManager,
    makeBridge: () => new ClaudeBridge(),
    allowedTokens: controlTokens,
    prisma,
  }),
);
controlRouter.use(
  makeControlSessionsRouter({ mgr: controlSessionManager, prisma, allowedTokens: controlTokens }),
);
controlRouter.use(makeControlHistoryRouter({ prisma, allowedTokens: controlTokens }));
controlRouter.use(
  makeControlUploadRouter({
    inboxDir,
    allowedTokens: controlTokens,
    maxFileSizeBytes: 25 * 1024 * 1024,
  }),
);
controlRouter.use(
  makeVaultRouter({
    vaultDir,
    seanNotesDir,
    allowedTokens: controlTokens,
    maxFileBytes: 10 * 1024 * 1024,
  }),
);
// Routines (recurring tasks) — first whitelisted Telegram id is treated as
// "Benjamin" for runner notifications. If the env list is empty we still
// allow the runner to boot; Telegram-channel notifications will fail-soft.
const benjaminTelegramId = config.ALLOWED_TELEGRAM_USER_IDS[0] ?? 0n;
controlRouter.use(
  makeRoutinesRouter({
    prisma,
    bot,
    benjaminTelegramId,
    allowedTokens: controlTokens,
  }),
);
// Suggestion queue — Sean's autonomous proposals.
controlRouter.use(makeSuggestionsRouter({ prisma, allowedTokens: controlTokens }));
// Persona endpoint — desktop client fetches Sean's persona to inject as the
// system prompt when routing a thread through Ollama (cross-model identity).
controlRouter.use(makeControlPersonaRouter({ allowedTokens: controlTokens }));
app.use('/control', controlRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'express error');
  if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
});

async function main() {
  await initTelegramBot();
  // Boot the routines runner. Failure is non-fatal — log and continue so
  // a bad cron string in one row can never block the whole gateway start.
  try {
    await startRoutinesRunner({ prisma, bot, benjaminTelegramId });
  } catch (err) {
    logger.error({ err }, 'routines runner failed to start (continuing)');
  }
  // Suggestion-generator: cron tick + periodic expiration sweep. Both are
  // best-effort — never let them crash the gateway boot.
  try {
    await startSuggestionsGenerator({ prisma, config: {} });
  } catch (err) {
    logger.error({ err }, 'suggestions generator failed to start (continuing)');
  }
  const expirationSweep = startExpirationSweep(prisma);
  const cleanupTimer = startInboxCleanupInterval(inboxDir);

  // Periodic codebase pull. The boot-time clone happens in
  // docker-entrypoint.sh; this runtime tick keeps Sean's reference fresh
  // throughout long uptimes. Failures are logged at WARN and never fatal —
  // a stale reference is acceptable; a crashed gateway is not.
  const codebaseDir = join(config.WORKSPACE_DIR, 'codebase');
  const codebasePullTimer = setInterval(() => {
    exec(
      `git -C ${JSON.stringify(codebaseDir)} pull --quiet --depth=1 origin main`,
      { timeout: 60_000 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.warn({ err: err.message, stderr: stderr.slice(0, 400) }, 'codebase periodic pull failed');
        }
      },
    );
  }, 30 * 60 * 1000);
  // Don't block process exit on this timer.
  codebasePullTimer.unref();

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'gateway listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(cleanupTimer);
    clearInterval(expirationSweep);
    clearInterval(codebasePullTimer);
    stopSuggestionsGenerator();
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'gateway failed to start');
  process.exit(1);
});
