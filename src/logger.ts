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
  // MCP connector keys — never log. Travel ephemerally per request.
  '*.FIRECRAWL_API_KEY',
  '*.GITHUB_PERSONAL_ACCESS_TOKEN',
  '*.VERCEL_TOKEN',
  '*.connectorKeys.FIRECRAWL_API_KEY',
  '*.connectorKeys.GITHUB_PERSONAL_ACCESS_TOKEN',
  '*.connectorKeys.VERCEL_TOKEN',
  'connectorKeys.FIRECRAWL_API_KEY',
  'connectorKeys.GITHUB_PERSONAL_ACCESS_TOKEN',
  'connectorKeys.VERCEL_TOKEN',
  'req.body.connectorKeys.FIRECRAWL_API_KEY',
  'req.body.connectorKeys.GITHUB_PERSONAL_ACCESS_TOKEN',
  'req.body.connectorKeys.VERCEL_TOKEN',
  // Per-user Claude OAuth token — supplied in /control/message body and
  // forwarded into the claude-code spawn env. Never persisted.
  '*.claudeAuthToken',
  'claudeAuthToken',
  'req.body.claudeAuthToken',
  'env.CLAUDE_CODE_OAUTH_TOKEN',
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
