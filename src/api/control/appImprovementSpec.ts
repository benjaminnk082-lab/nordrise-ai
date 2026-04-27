/**
 * appImprovementSpec.ts — Opus-driven spec generation for an approved
 * AppImprovement.
 *
 * When the user approves an improvement (POST /control/app-improvements/:id/approve),
 * we kick off this fire-and-forget background pass. Sean is woken on Opus,
 * pointed at /app/workspace/codebase/, and asked to write a detailed
 * implementation spec to /app/workspace/sean-notes/app-improvements/<date>-<slug>.md.
 *
 * Once the file is written, the row gets status='spec-written' and
 * vaultPath set to the relative path. The existing sean-notes -> vault
 * sync surfaces the file in Obsidian; from there a separate Claude session
 * (the "Cursor"-equivalent) can pick the spec up and implement it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient, AppImprovement } from '@prisma/client';
import { ClaudeBridge } from '../../claudeBridge.js';
import { logger } from '../../logger.js';

/**
 * Slugify a title for use in a filename. Lowercase, ASCII-friendly, dashes
 * for spaces/punctuation, no edge dashes, capped at 50 chars. Strips Unicode
 * letters above ASCII via NFKD + replace; safe for any FS we run on.
 */
export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const replaced = ascii
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return replaced || 'forbedring';
}

function todayDateStr(now: Date = new Date()): string {
  // YYYY-MM-DD in local time. Acceptable coupling: routines.runOnce already
  // runs in the host TZ.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface GenerateSpecDeps {
  prisma: PrismaClient;
  /** Absolute path to the seanNotes root, e.g. /app/workspace/sean-notes. */
  seanNotesDir: string;
  /** Test seam — defaults to a fresh ClaudeBridge per invocation. */
  makeBridge?: () => Pick<ClaudeBridge, 'invoke'>;
}

/**
 * Background spec-generation. Always returns; never throws. Writes status
 * back to the AppImprovement row.
 */
export async function generateSpec(
  deps: GenerateSpecDeps,
  improvementId: string,
): Promise<void> {
  let row: AppImprovement | null;
  try {
    row = await deps.prisma.appImprovement.findUnique({
      where: { id: improvementId },
    });
  } catch (err) {
    logger.warn({ err, improvementId }, 'app-improvement spec: lookup failed');
    return;
  }
  if (!row || row.status !== 'approved') return;

  const date = todayDateStr();
  const slug = slugify(row.title);
  const relPath = `app-improvements/${date}-${slug}.md`;
  const absPath = join(deps.seanNotesDir, relPath);

  const message = `Du er Sean. Benjamin har godkjent denne app-forbedringen:

Tittel: ${row.title}
Kategori: ${row.category}
Beskrivelse: ${row.description}
Rasjonale: ${row.rationale}
Mønster: ${row.patternEvidence ?? '(ingen)'}

Nå skal du skrive en detaljert implementasjons-spec som en fremtidig Claude-session kan utføre. Du har lese-tilgang til /app/workspace/codebase/. Bruk den.

Skriv specet til ${absPath} med disse seksjonene:

# ${row.title}

## Problem
(Hva er feil eller mangler?)

## Forslått løsning
(Hva skal gjøres?)

## Filer som påvirkes
(List paths under codebase/, med konkrete linjer der mulig)

## Implementasjon
(Pseudokode eller detaljert beskrivelse)

## Tester
(Hva må testes?)

## Estimat
(Hvor lang tid ~ tar dette?)

## Risikoer
(Hva kan gå galt?)

Når ferdig, returner kun stien til filen du skrev (ingen forklaring).`;

  const bridge = deps.makeBridge ? deps.makeBridge() : new ClaudeBridge();
  let result;
  try {
    result = await bridge.invoke({
      message,
      sessionId: null,
      model: 'claude-opus-4-7',
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, improvementId },
      'app-improvement spec: bridge crashed',
    );
    return;
  }

  if (result.isError) {
    logger.warn(
      { err: result.errorMessage, improvementId },
      'app-improvement spec: bridge error',
    );
    return;
  }

  // Sean is supposed to write the file via its own Write/Edit tool. As a
  // fallback (in case the persona's Write tool isn't available in this
  // environment), we also write the result text to disk ourselves so the
  // sean-notes flow always surfaces something. The persona-written file
  // wins if both exist.
  try {
    await mkdir(join(absPath, '..'), { recursive: true });
    // Only write the fallback if no file exists yet — don't clobber Sean's
    // tool-written content. Use `wx` to fail when present.
    try {
      await writeFile(absPath, result.text, { flag: 'wx' });
    } catch {
      // file already exists — Sean's tool-written copy wins, fine.
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, improvementId, absPath },
      'app-improvement spec: fallback write failed',
    );
  }

  try {
    await deps.prisma.appImprovement.update({
      where: { id: improvementId },
      data: {
        status: 'spec-written',
        proposedSpec: result.text.slice(0, 20_000),
        specWrittenAt: new Date(),
        vaultPath: relPath,
      },
    });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, improvementId },
      'app-improvement spec: row update failed',
    );
  }
}
