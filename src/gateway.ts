/**
 * gateway.ts — Express entrypoint.
 *
 * Single Telegram webhook endpoint. Healthcheck. Graceful shutdown.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config.js';
import { logger } from './logger.js';
import { handleUpdate, initTelegramBot } from './channels/telegram.js';
import { prisma } from './db.js';

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
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  res.json({
    status: db === 'ok' ? 'ok' : 'degraded',
    authMode: 'subscription',
    db,
    uptimeSec: Math.floor(process.uptime()),
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'express error');
  if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
});

async function main() {
  await initTelegramBot();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'gateway listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
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
