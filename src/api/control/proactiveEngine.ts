/**
 * proactiveEngine.ts
 *
 * Cron-driven autonomous worker that decides when Sean should message
 * Benjamin on Telegram unprompted. Every 15 min the engine wakes Sean in a
 * special "proactive mode" with a meta-prompt; Sean answers with a strict
 * JSON decision (`send`, `category`, `reason`, `message`). If `send=true`
 * we deliver via the existing grammY bot; either way the attempt lands in
 * ProactiveAttempt for auditability.
 *
 * Hard guardrails — non-negotiable, all four are tested:
 *   1. ProactiveSettings.enabled=false → 'disabled', no bridge spawn.
 *   2. Quiet hours (default 22-08 local) → 'quiet_hours'.
 *   3. Rate limits per-hour / per-day → 'rate_limited'.
 *   4. Recent user activity (Message in last 30 min) → 'skipped' so Sean
 *      never interrupts an active thread.
 * Plus an env-level kill switch: `PROACTIVE_DISABLED=true` prevents the
 * cron from being scheduled at all (no DB row created either).
 *
 * Permission model: this engine intentionally does NOT enforce backend
 * permissions for vault-write / Telegram / web-search / github. The
 * v0.3.3 pt-1 batch flips desktop-app defaults to "auto"; backend
 * enforcement is a v0.4.0 concern. Sean operating via Telegram or via
 * proactive ticks therefore runs with whatever his persona allows. The
 * effective controls today are:
 *   - The `enabled`/quiet-hours/rate-limit/user-active guardrails above.
 *   - Persona's "Irreversible handlinger"-section that asks Sean to
 *     confirm before destructive actions.
 *   - Schema-validated JSON output (zod) bounding what the engine can
 *     ever post.
 */

import * as cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { Bot } from 'grammy';
import { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

const META_PROMPT = `Du er Sean i proaktiv-modus. Du er IKKE i samtale nå — du beslutter om DU skal sende en uoppfordret melding til Benjamin på Telegram.

Sjekk konteksten:
- Vaulten på /app/workspace/vault/ (særlig Daglig/, Inbox/, journal/)
- Dine egne notater på /app/workspace/sean-notes/
- Recent activity (siste 24t)

Beslutt om du har noe genuint verdt å sende NÅ:
- Et spørsmål du trenger svar på for å fullføre noe
- Status om noe du jobber med (eks. "Jeg har lest ferdig vault og oppdatert MEMORY.md")
- En idé du vil dele
- En observasjon eller mønster du har sett
- En vennlig check-in (sjelden — max én per dag)

VIKTIG:
- Ikke send hvis du ikke har noe konkret. Det er bedre å skippe enn å spamme.
- Korte meldinger. Maks 280 tegn for status, maks 600 tegn for ideer.
- Norsk, direkte, Sean-style.
- Ikke send "hei" eller small talk.

Output STRENGT som JSON:
{
  "send": true/false,
  "category": "question" | "status" | "idea" | "observation" | "check-in",
  "reason": "kort begrunnelse for hvorfor du sender (eller hvorfor ikke)",
  "message": "selve meldingen som sendes til Benjamin (eller null hvis send=false)"
}`;

const DecisionSchema = z.object({
  send: z.boolean(),
  category: z
    .enum(['question', 'status', 'idea', 'observation', 'check-in'])
    .optional(),
  reason: z.string().max(500),
  message: z.string().max(1500).nullable().optional(),
});

export interface ProactiveDeps {
  prisma: PrismaClient;
  bot: Pick<Bot, 'api'>;
  benjaminTelegramId: bigint;
  envDisabled: boolean;
  /** Test seam — defaults to a fresh ClaudeBridge per invocation. */
  makeBridge?: () => Pick<ClaudeBridge, 'invoke'>;
}

let task: cron.ScheduledTask | null = null;

/**
 * Boot the proactive engine cron. Idempotent. The internal `runOnce` does
 * the actual settings/quiet-hours/rate-limit checks on every tick — we
 * fire on a fixed 15 min cadence and let `runOnce` decide if anything
 * happens. (Per the spec, `cadenceMin` in settings is informational for
 * future tightening; current cron is hard-coded to every 15 minutes.)
 */
export async function startProactiveEngine(deps: ProactiveDeps): Promise<void> {
  if (deps.envDisabled) {
    logger.info('proactive engine disabled via PROACTIVE_DISABLED env');
    return;
  }
  if (task) return;
  task = cron.schedule(
    '*/15 * * * *',
    () => {
      void runOnce(deps).catch((err) => {
        logger.warn({ err }, 'proactive engine tick crashed');
      });
    },
    { scheduled: true },
  );
  logger.info('proactive engine started (cadence 15min)');
}

export function stopProactiveEngine(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

/** Initialise the singleton ProactiveSettings row if it doesn't exist. */
async function getSettings(prisma: PrismaClient) {
  let s = await prisma.proactiveSettings.findFirst();
  if (!s) {
    s = await prisma.proactiveSettings.create({ data: {} });
  }
  return s;
}

/**
 * Returns true when the current local hour is inside the configured quiet
 * window. Inclusive on `quietHourStart`, exclusive on `quietHourEnd`. Handles
 * wrap-around (e.g. 22→8 covers 22, 23, 0..7).
 */
export function inQuietHours(
  s: { quietHourStart: number; quietHourEnd: number },
  now: Date = new Date(),
): boolean {
  const h = now.getHours();
  if (s.quietHourStart < s.quietHourEnd) {
    return h >= s.quietHourStart && h < s.quietHourEnd;
  }
  // Wrap-around (e.g. 22→8): quiet if h ∈ [22, 24) ∪ [0, 8).
  return h >= s.quietHourStart || h < s.quietHourEnd;
}

export interface RunOnceResult {
  decision: 'sent' | 'skipped' | 'rate_limited' | 'quiet_hours' | 'disabled';
  reason?: string;
}

/**
 * Single proactive tick. Safe to call from cron OR from /run-now.
 * Always writes a ProactiveAttempt row (one per call) so the desktop app
 * can render an audit trail.
 */
export async function runOnce(deps: ProactiveDeps): Promise<RunOnceResult> {
  const settings = await getSettings(deps.prisma);

  // Guardrail 1: soft kill via settings.
  if (!settings.enabled) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'disabled', reason: 'settings.enabled=false' },
    });
    return { decision: 'disabled' };
  }

  // Guardrail 2: quiet hours.
  if (inQuietHours(settings)) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'quiet_hours', reason: `hour=${new Date().getHours()}` },
    });
    return { decision: 'quiet_hours' };
  }

  // Guardrail 3a: per-hour rate limit.
  const oneHour = new Date(Date.now() - 60 * 60 * 1000);
  const sentLastHour = await deps.prisma.proactiveAttempt.count({
    where: { triggeredAt: { gt: oneHour }, decision: 'sent' },
  });
  if (sentLastHour >= settings.maxPerHour) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'rate_limited', reason: `${sentLastHour}/h` },
    });
    return { decision: 'rate_limited', reason: `${sentLastHour}/h` };
  }

  // Guardrail 3b: per-day rate limit.
  const oneDay = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentLastDay = await deps.prisma.proactiveAttempt.count({
    where: { triggeredAt: { gt: oneDay }, decision: 'sent' },
  });
  if (sentLastDay >= settings.maxPerDay) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'rate_limited', reason: `${sentLastDay}/day` },
    });
    return { decision: 'rate_limited', reason: `${sentLastDay}/day` };
  }

  // Guardrail 4: skip when user is mid-conversation. Telegram messages and
  // /control/message both write to Message, so a 30-minute lookback covers
  // both surfaces. We never want to interrupt an active thread.
  const recentMsg = await deps.prisma.message.findFirst({
    where: { createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
  });
  if (recentMsg) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'skipped', reason: 'user_active' },
    });
    return { decision: 'skipped', reason: 'user_active' };
  }

  // All guardrails clear — ask Sean (Haiku, cheap).
  const bridge = deps.makeBridge ? deps.makeBridge() : new ClaudeBridge();
  let result;
  try {
    result = await bridge.invoke({
      message: META_PROMPT,
      sessionId: null,
      model: 'claude-haiku-4-5',
    });
  } catch (err) {
    await deps.prisma.proactiveAttempt.create({
      data: {
        decision: 'skipped',
        reason: `bridge_error: ${(err as Error).message}`,
      },
    });
    return { decision: 'skipped', reason: 'bridge_error' };
  }

  if (result.isError) {
    await deps.prisma.proactiveAttempt.create({
      data: {
        decision: 'skipped',
        reason: `bridge_error: ${result.errorMessage ?? 'unknown'}`,
      },
    });
    return { decision: 'skipped', reason: 'bridge_error' };
  }

  // Extract the JSON decision. Haiku occasionally wraps in fences/prose
  // even when the meta-prompt forbids it — match the outermost {…}.
  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'skipped', reason: 'no_json' },
    });
    return { decision: 'skipped', reason: 'no_json' };
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'skipped', reason: 'invalid_json' },
    });
    return { decision: 'skipped', reason: 'invalid_json' };
  }
  const validated = DecisionSchema.safeParse(parsed);
  if (!validated.success) {
    await deps.prisma.proactiveAttempt.create({
      data: { decision: 'skipped', reason: 'invalid_json' },
    });
    return { decision: 'skipped', reason: 'invalid_json' };
  }

  // Sean voluntarily decided to skip.
  if (!validated.data.send || !validated.data.message) {
    await deps.prisma.proactiveAttempt.create({
      data: {
        decision: 'skipped',
        reason: validated.data.reason,
        ...(validated.data.category ? { category: validated.data.category } : {}),
      },
    });
    return { decision: 'skipped', reason: validated.data.reason };
  }

  // Send via Telegram.
  try {
    await deps.bot.api.sendMessage(
      Number(deps.benjaminTelegramId),
      validated.data.message,
    );
  } catch (err) {
    await deps.prisma.proactiveAttempt.create({
      data: {
        decision: 'skipped',
        reason: `telegram_failed: ${(err as Error).message}`,
        message: validated.data.message,
        ...(validated.data.category ? { category: validated.data.category } : {}),
      },
    });
    return { decision: 'skipped', reason: 'telegram_failed' };
  }

  await deps.prisma.proactiveAttempt.create({
    data: {
      decision: 'sent',
      reason: validated.data.reason,
      message: validated.data.message,
      ...(validated.data.category ? { category: validated.data.category } : {}),
      ...(typeof result.costUsd === 'number' ? { costUsd: result.costUsd } : {}),
    },
  });
  logger.info({ category: validated.data.category }, 'proactive: sent');
  return { decision: 'sent' };
}

/** Test hook — clears the active scheduled task. */
export function _resetTaskForTesting(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
