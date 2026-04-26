/**
 * suggestionsGenerator.ts
 *
 * Sean's autonomous proposal queue. A node-cron task fires hourly between
 * 09 and 22 local time; when no user message has arrived in the last
 * 60 minutes we wake Sean in "reflection mode" with a meta-prompt asking
 * for 0–3 JSON-encoded proposals. Each proposal becomes a Suggestion row
 * with status='pending'. The user approves/rejects in the desktop app;
 * approval triggers `executeApproved` which runs the proposal's prompt as
 * a fresh control session and stores the result back on the row.
 *
 * Hard constraints (v0.2.1 spec):
 *   1. Generator MUST use Haiku (cheap), never Opus.
 *   2. Meta-prompt forbids destructive actions / sends / pushes.
 *   3. Validator caps title/rationale/prompt lengths to mitigate
 *      prompt-injection-of-noise.
 *   4. ANTHROPIC_API_KEY is never set; ClaudeBridge already strips it.
 */

import * as cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import type { Bot } from 'grammy';
import { z } from 'zod';
import { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

/**
 * Optional Telegram-notification deps for `executeApproved`. When provided
 * we post "🔧 Jobber med forslag: <title>" to Benjamin at start so the
 * proactive feel extends to suggestion executions. Best-effort — never
 * throws.
 */
export interface ExecuteNotifyDeps {
  bot: Pick<Bot, 'api'>;
  benjaminTelegramId: bigint;
}

const SUGGESTION_META_PROMPT = `Du er Sean i refleksjonsmodus. Du er IKKE i samtale med Benjamin nå — du analyserer kontekst og genererer valgfrie forslag til ting du KUNNE gjort som ville vært nyttige.

Kontekst-tilgang:
- Vaulten i /app/workspace/vault/ (les fritt, spesielt Daglig/, Inbox/, Grunderskap/)
- Dine egne notater i /app/workspace/memory/
- Dine sean-notes i /app/workspace/sean-notes/

Generer 0-3 forslag. Kun forslag som:
1. Er genuint nyttige (ikke fyll)
2. Har avgrenset scope (kan utføres på under 5 min)
3. Er reversible (ikke sender e-post, ikke pusher kode, ikke endrer prod)

Output STRENGT som JSON-array, INGEN markdown, INGEN forklaring rundt:

[
  {
    "type": "research" | "cleanup" | "check" | "remind" | "idea" | "note",
    "title": "Kort tittel (max 80 tegn)",
    "rationale": "Hvorfor dette er nyttig nå (max 200 tegn)",
    "prompt": "Den eksakte prompten som vil bli kjørt hvis godkjent (du gir denne til deg-selv senere)",
    "expiresInH": 24
  }
]

Hvis ingen relevante forslag, returner [].`;

const SuggestionSchema = z
  .array(
    z.object({
      type: z.enum(['research', 'cleanup', 'check', 'remind', 'idea', 'note']),
      title: z.string().min(1).max(200),
      rationale: z.string().min(1).max(500),
      prompt: z.string().min(1).max(5000),
      expiresInH: z.number().int().min(1).max(168).default(24),
    }),
  )
  .max(3);

export interface GeneratorDeps {
  prisma: PrismaClient;
  /** Optional config bag — kept for parity with other runners; unused today. */
  config?: { TZ?: string };
  /** Test seam — defaults to a fresh ClaudeBridge per invocation. */
  makeBridge?: () => ClaudeBridge;
}

let task: cron.ScheduledTask | null = null;

/**
 * Boot the cron task. Top-of-hour, 09–22 local time.
 *
 * Verified expression: `'0 9-22 * * *'` fires at 09:00, 10:00, …, 22:00.
 * `cron.validate` accepts it; `node-cron` runs in the host's local timezone
 * which on Railway maps to whatever TZ env is set (defaulting to UTC).
 */
export async function startSuggestionsGenerator(deps: GeneratorDeps): Promise<void> {
  if (task) return; // idempotent
  if (!cron.validate('0 9-22 * * *')) {
    logger.warn('suggestions generator: invalid cron expression — skipped');
    return;
  }
  task = cron.schedule(
    '0 9-22 * * *',
    () => {
      void generateOnce(deps).catch((err) => {
        logger.warn({ err }, 'suggestions generator: tick failed');
      });
    },
    { scheduled: true },
  );
  logger.info('suggestions generator started');
}

export function stopSuggestionsGenerator(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

async function isQuietWindow(prisma: PrismaClient): Promise<boolean> {
  const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.message.count({
    where: { createdAt: { gt: sixtyMinAgo } },
  });
  return recent === 0;
}

export interface GenerateOnceResult {
  generated: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Single generator pass. Idempotent and safe to call from the cron task or
 * the /generate-now endpoint. Returns a structured result so callers can
 * surface "skipped: too_many_pending" etc. to the UI without exceptions.
 */
export async function generateOnce(deps: GeneratorDeps): Promise<GenerateOnceResult> {
  // Don't pile up duplicates if many pending already.
  const pending = await deps.prisma.suggestion.count({ where: { status: 'pending' } });
  if (pending >= 5) {
    return { generated: 0, skipped: true, reason: 'too_many_pending' };
  }
  if (!(await isQuietWindow(deps.prisma))) {
    return { generated: 0, skipped: true, reason: 'not_quiet' };
  }

  const bridge = deps.makeBridge ? deps.makeBridge() : new ClaudeBridge();
  const result = await bridge.invoke({
    message: SUGGESTION_META_PROMPT,
    sessionId: null,
    // Hard constraint #3: cheap model only. Never Opus.
    model: 'claude-haiku-4-5',
  });

  if (result.isError) {
    logger.warn({ err: result.errorMessage }, 'suggestion generator: bridge error');
    return { generated: 0, skipped: true, reason: 'bridge_error' };
  }

  // Extract JSON from result.text — Haiku sometimes wraps it in code fences
  // or emits a leading explanation despite the meta-prompt. Match the
  // outermost array greedily so multi-line objects survive.
  const jsonMatch = result.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.warn('suggestion generator: no JSON array in response');
    return { generated: 0, skipped: true, reason: 'no_json' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { generated: 0, skipped: true, reason: 'invalid_json' };
  }

  const validated = SuggestionSchema.safeParse(parsed);
  if (!validated.success) {
    logger.warn(
      { issues: validated.error.issues },
      'suggestion generator: schema mismatch',
    );
    return { generated: 0, skipped: true, reason: 'invalid_schema' };
  }

  let count = 0;
  for (const s of validated.data) {
    const expiresAt = new Date(Date.now() + s.expiresInH * 60 * 60 * 1000);
    await deps.prisma.suggestion.create({
      data: {
        type: s.type,
        title: s.title,
        rationale: s.rationale,
        prompt: s.prompt,
        expiresAt,
        status: 'pending',
      },
    });
    count++;
  }
  logger.info({ count }, 'suggestions generated');
  return { generated: count, skipped: false };
}

/**
 * Fire-and-forget executor for an approved suggestion. The route handler
 * has already flipped status='approved'; this function runs the prompt
 * via a fresh ClaudeBridge session and writes status='done' or 'failed'
 * + result/errorMsg/durationMs back onto the row.
 *
 * Note: deliberately swallows all errors to a 'failed' row — never throws.
 */
export async function executeApproved(
  prisma: PrismaClient,
  suggestionId: string,
  makeBridge: () => ClaudeBridge = () => new ClaudeBridge(),
  notify?: ExecuteNotifyDeps,
): Promise<void> {
  const s = await prisma.suggestion.findUnique({ where: { id: suggestionId } });
  if (!s || s.status !== 'approved') return;

  // Status heads-up. Same "Sean is at work" pattern as routines. Best-effort.
  if (notify) {
    try {
      await notify.bot.api.sendMessage(
        Number(notify.benjaminTelegramId),
        `🔧 Jobber med forslag: ${s.title}`,
      );
    } catch (err) {
      logger.warn({ err, suggestionId: s.id }, 'suggestion telegram start-notify failed');
    }
  }

  const started = Date.now();
  try {
    const bridge = makeBridge();
    const result = await bridge.invoke({
      message: s.prompt,
      sessionId: null,
    });
    const durationMs = Date.now() - started;
    if (result.isError) {
      await prisma.suggestion.update({
        where: { id: s.id },
        data: {
          status: 'failed',
          errorMsg: result.errorMessage ?? 'bridge_error',
          executedAt: new Date(),
          durationMs,
        },
      });
      return;
    }
    await prisma.suggestion.update({
      where: { id: s.id },
      data: {
        status: 'done',
        result: result.text,
        executedAt: new Date(),
        durationMs,
      },
    });
  } catch (err) {
    await prisma.suggestion.update({
      where: { id: s.id },
      data: {
        status: 'failed',
        errorMsg: String((err as Error).message),
        executedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });
  }
}

/**
 * Periodic expiration sweep. Returns the interval handle so gateway.ts can
 * `clearInterval(handle)` during graceful shutdown.
 */
export function startExpirationSweep(prisma: PrismaClient): NodeJS.Timeout {
  return setInterval(
    () => {
      void prisma.suggestion
        .updateMany({
          where: { status: 'pending', expiresAt: { lt: new Date() } },
          data: { status: 'expired' },
        })
        .catch((err) => {
          logger.warn({ err }, 'suggestion expiration sweep failed');
        });
    },
    5 * 60 * 1000,
  );
}

/** Test hook — exported only for unit tests. */
export function _stopForTesting(): void {
  stopSuggestionsGenerator();
}
