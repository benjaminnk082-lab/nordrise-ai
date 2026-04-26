/**
 * gateway.ts — Express entrypoint.
 *
 * Telegram webhook + /control routes. Healthcheck. Graceful shutdown.
 */

import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, controlTokens } from './config.js';
import { logger } from './logger.js';
import { handleUpdate, initTelegramBot } from './channels/telegram.js';
import { prisma } from './db.js';
import { ClaudeBridge } from './claudeBridge.js';
import { controlSessionManager } from './controlSessionManager.js';
import { makeControlMessageRouter } from './api/control/messageRoute.js';
import { makeControlSessionsRouter } from './api/control/sessionsRoute.js';
import { makeControlHistoryRouter } from './api/control/historyRoute.js';
import { makeControlUploadRouter } from './api/control/uploadRoute.js';
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
mkdirSync(inboxDir, { recursive: true });

const controlRouter = Router();
controlRouter.use(
  makeControlMessageRouter({
    mgr: controlSessionManager,
    makeBridge: () => new ClaudeBridge(),
    allowedTokens: controlTokens,
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
app.use('/control', controlRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'express error');
  if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
});

async function main() {
  await initTelegramBot();
  const cleanupTimer = startInboxCleanupInterval(inboxDir);
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'gateway listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(cleanupTimer);
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
