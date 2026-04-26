import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  CLAUDE_CODE_OAUTH_TOKEN: z.string().min(20, 'CLAUDE_CODE_OAUTH_TOKEN missing — run `claude setup-token`'),
  TELEGRAM_BOT_TOKEN: z.string().min(20, 'TELEGRAM_BOT_TOKEN missing — get from @BotFather'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16, 'TELEGRAM_WEBHOOK_SECRET missing — run `npm run gen-secret`'),

  ALLOWED_TELEGRAM_USER_IDS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const n = BigInt(x);
          return n;
        }),
    ),

  DATABASE_URL: z.string().url(),
  GATEWAY_PUBLIC_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  SESSION_TIMEOUT_HOURS: z.coerce.number().positive().default(24),
  CLAUDE_CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  RATE_LIMIT_MAX_MESSAGES: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  WORKSPACE_DIR: z.string().default('/app/workspace'),

  CONTROL_API_TOKENS: z.string().default(''),
});

function mustNotHaveAnthropicApiKey() {
  if (process.env.ANTHROPIC_API_KEY) {
    // This would silently route all traffic to the paid API — refuse to boot.
    throw new Error(
      'ANTHROPIC_API_KEY is set. Sean must only use the Claude Max subscription via CLAUDE_CODE_OAUTH_TOKEN. Unset ANTHROPIC_API_KEY and restart.',
    );
  }
}

mustNotHaveAnthropicApiKey();

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;

export function parseControlTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export const controlTokens = parseControlTokens(config.CONTROL_API_TOKENS);
