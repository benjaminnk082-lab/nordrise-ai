/**
 * appImprovementWatcher.ts — Sean's self-improvement watcher.
 *
 * A node-cron task fires daily at 02:00 (one hour before Sean Dreams). It
 * inspects the last 7 days of:
 *   - Messages (volume + assistant errors)
 *   - Suggestions (rejected / failed)
 *   - RoutineRun (failures)
 *   - ProactiveAttempt (skips, rate limits)
 * and asks Sean (via Sonnet — heavier than Haiku, lighter than Opus) for
 * up to 3 KONKRETE, avgrensede, verifiserbare app-forbedringer.
 *
 * Each proposal becomes an AppImprovement row, status='pending'. The user
 * approves via /control/app-improvements/:id/approve which spawns a fresh
 * Opus pass that writes a detailed spec to sean-notes/app-improvements/
 * (auto-merged into the vault by the existing sync).
 */

import * as cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

const ProposalSchema = z
  .array(
    z.object({
      category: z.enum([
        'bug-fix',
        'feature',
        'ux',
        'performance',
        'security',
      ]),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(2000),
      rationale: z.string().min(1).max(1500),
      patternEvidence: z.string().max(1500).optional(),
    }),
  )
  .max(3);

export interface AppImprovementWatcherDeps {
  prisma: PrismaClient;
  /** Test seam — defaults to a fresh ClaudeBridge per invocation. */
  makeBridge?: () => Pick<ClaudeBridge, 'invoke'>;
}

let task: cron.ScheduledTask | null = null;

export async function startAppImprovementWatcher(
  deps: AppImprovementWatcherDeps,
): Promise<void> {
  if (task) return; // idempotent
  if (!cron.validate('0 2 * * *')) {
    logger.warn('app-improvement watcher: invalid cron — skipped');
    return;
  }
  task = cron.schedule(
    '0 2 * * *',
    () => {
      void scanOnce(deps).catch((err) => {
        logger.warn({ err }, 'app-improvement watcher: tick crashed');
      });
    },
    { scheduled: true },
  );
  logger.info('app-improvement watcher started (02:00 daily)');
}

export function stopAppImprovementWatcher(): void {
  if (task) {
    task.stop();
    task = null;
  }
}

export interface ScanResult {
  generated: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Build a compact text snapshot of the last 7-day usage data we feed Sean.
 * Counts + sampled reasons, not full content — keeps the prompt tight and
 * avoids leaking message bodies into a low-priority Sonnet call.
 */
async function buildContextSnapshot(prisma: PrismaClient): Promise<string> {
  const sevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    msgCount,
    suggestionsByStatus,
    failedRoutineRuns,
    proactiveByDecision,
  ] = await Promise.all([
    prisma.message.count({ where: { createdAt: { gt: sevenDays } } }),
    prisma.suggestion.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { createdAt: { gt: sevenDays } },
    }),
    prisma.routineRun.findMany({
      where: { startedAt: { gt: sevenDays }, status: 'failed' },
      take: 10,
      orderBy: { startedAt: 'desc' },
      select: { errorMsg: true, routineId: true },
    }),
    prisma.proactiveAttempt.groupBy({
      by: ['decision'],
      _count: { _all: true },
      where: { triggeredAt: { gt: sevenDays } },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`Tidsvindu: siste 7 dager`);
  lines.push(`Meldinger total: ${msgCount}`);
  if (suggestionsByStatus.length > 0) {
    lines.push('Forslag-status:');
    for (const row of suggestionsByStatus) {
      lines.push(`  - ${row.status}: ${row._count._all}`);
    }
  } else {
    lines.push('Forslag-status: ingen');
  }
  if (failedRoutineRuns.length > 0) {
    lines.push(`Feilede routine-runs: ${failedRoutineRuns.length}`);
    for (const r of failedRoutineRuns.slice(0, 5)) {
      lines.push(`  - ${(r.errorMsg ?? 'ukjent').slice(0, 200)}`);
    }
  } else {
    lines.push('Feilede routine-runs: 0');
  }
  if (proactiveByDecision.length > 0) {
    lines.push('Proaktive avgjørelser:');
    for (const row of proactiveByDecision) {
      lines.push(`  - ${row.decision}: ${row._count._all}`);
    }
  } else {
    lines.push('Proaktive avgjørelser: ingen');
  }
  return lines.join('\n');
}

const META_PROMPT_PREFIX = `Du er Sean i app-improvement-modus. Du har data om hvordan Benjamin og Nordrise Control oppfører seg siste 7 dager.

Identifiser opp til 3 KONKRETE forbedringer i appen som ville hjelpe. Hver forbedring må være:
- Spesifikk og avgrenset (ikke "gjør appen bedre")
- Verifierbar (kan man se at det er fikset?)
- Liten nok å implementere (under en dag)

Output STRENGT som JSON-array, INGEN markdown, INGEN forklaring rundt:
[
  {
    "category": "bug-fix" | "feature" | "ux" | "performance" | "security",
    "title": "Kort tittel",
    "description": "Hva som bør gjøres",
    "rationale": "Hvorfor — basert på dataen over",
    "patternEvidence": "Konkret eksempel fra dataen"
  }
]

Hvis ingen relevante forbedringer, returner [].

Data:
`;

export async function scanOnce(
  deps: AppImprovementWatcherDeps,
): Promise<ScanResult> {
  // Cap pending to avoid pile-up.
  const pending = await deps.prisma.appImprovement.count({
    where: { status: 'pending' },
  });
  if (pending >= 10) {
    return { generated: 0, skipped: true, reason: 'too_many_pending' };
  }

  let snapshot: string;
  try {
    snapshot = await buildContextSnapshot(deps.prisma);
  } catch (err) {
    logger.warn({ err }, 'app-improvement watcher: snapshot failed');
    return { generated: 0, skipped: true, reason: 'snapshot_failed' };
  }

  const bridge = deps.makeBridge ? deps.makeBridge() : new ClaudeBridge();
  let result;
  try {
    result = await bridge.invoke({
      message: META_PROMPT_PREFIX + snapshot,
      sessionId: null,
      model: 'claude-sonnet-4-6',
    });
  } catch (err) {
    return {
      generated: 0,
      skipped: true,
      reason: `bridge_error: ${(err as Error).message}`,
    };
  }
  if (result.isError) {
    logger.warn(
      { err: result.errorMessage },
      'app-improvement watcher: bridge error',
    );
    return { generated: 0, skipped: true, reason: 'bridge_error' };
  }

  const m = result.text.match(/\[[\s\S]*\]/);
  if (!m) return { generated: 0, skipped: true, reason: 'no_json' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return { generated: 0, skipped: true, reason: 'invalid_json' };
  }
  const validated = ProposalSchema.safeParse(parsed);
  if (!validated.success) {
    logger.warn(
      { issues: validated.error.issues },
      'app-improvement watcher: schema mismatch',
    );
    return { generated: 0, skipped: true, reason: 'invalid_schema' };
  }

  let count = 0;
  for (const p of validated.data) {
    await deps.prisma.appImprovement.create({
      data: {
        category: p.category,
        title: p.title,
        description: p.description,
        rationale: p.rationale,
        ...(p.patternEvidence ? { patternEvidence: p.patternEvidence } : {}),
        status: 'pending',
      },
    });
    count++;
  }
  logger.info({ count }, 'app-improvement watcher: proposals generated');
  return { generated: count, skipped: false };
}

/** Test hook. */
export function _resetTaskForTesting(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
