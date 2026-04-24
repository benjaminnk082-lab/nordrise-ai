import { pino, stdTimeFunctions } from 'pino';
import { config } from './config.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-telegram-bot-api-secret-token"]',
  '*.CLAUDE_CODE_OAUTH_TOKEN',
  '*.TELEGRAM_BOT_TOKEN',
  '*.TELEGRAM_WEBHOOK_SECRET',
  '*.DATABASE_URL',
  'env.CLAUDE_CODE_OAUTH_TOKEN',
  'env.TELEGRAM_BOT_TOKEN',
  'env.TELEGRAM_WEBHOOK_SECRET',
  'env.DATABASE_URL',
  'token',
  'oauthToken',
  'secret',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'nordrise-ai' },
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  timestamp: stdTimeFunctions.isoTime,
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
