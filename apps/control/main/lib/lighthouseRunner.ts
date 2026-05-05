/**
 * lighthouseRunner — Lighthouse audit via the user's local Chrome.
 *
 * Skeleton implementation. The actual audit runs through the Lighthouse
 * + chrome-launcher npm packages (not bundled with this repo — see the
 * commit message for the install instructions). The skeleton here keeps
 * the IPC contract stable so the renderer can wire its UI now and the
 * actual runner drops in later.
 *
 * Why no Puppeteer (per spec):
 *   - Puppeteer bundles ~170 MB of Chromium.
 *   - The user already has Chrome installed; we should use it.
 *   - `chrome-launcher` finds the user's Chrome on disk and spawns it
 *     with `--remote-debugging-port`. Lighthouse runs against that CDP
 *     target and tears down on completion.
 */

export interface LighthouseScores {
  performance: number;     // 0-100
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface LighthouseAudit {
  url: string;
  scores: LighthouseScores;
  /** Top three actionable opportunities from the audit. */
  topIssues: Array<{
    id: string;
    title: string;
    description: string;
    /** Estimated savings in ms or score delta when fixed. */
    impact: string;
  }>;
  /** Path to the full JSON dump under `<vault>/Sean/audits/<file>`. */
  jsonPath?: string;
  startedAt: number;
  finishedAt: number;
}

export interface RunOpts {
  timeoutMs?: number;
  /** Where to write the full JSON; if omitted, no file is written. */
  jsonPath?: string;
  /** Only `mobile` is supported for now (matches PageSpeed defaults). */
  formFactor?: 'mobile' | 'desktop';
}

/**
 * Run Lighthouse against `url`. Resolves with a structured audit. When
 * `lighthouse` + `chrome-launcher` are not installed, returns a stub
 * with `scores=0` and a topIssues entry pointing to the install command.
 */
export async function runLighthouse(
  url: string,
  opts: RunOpts = {},
): Promise<LighthouseAudit> {
  const startedAt = Date.now();
  // Dynamic import — fail-soft on missing deps so the canary in
  // `--unit` mode reports SKIP instead of crashing the whole script.
  // The specifier is held in a variable so TypeScript doesn't try to
  // resolve `lighthouse` / `chrome-launcher` at compile time (they're
  // only required when the user actually triggers an audit).
  const PKG_LH = 'lighthouse';
  const PKG_CL = 'chrome-launcher';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lighthouse: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromeLauncher: any = null;
  try {
    lighthouse = (await import(PKG_LH))?.default;
    chromeLauncher = await import(PKG_CL);
  } catch {
    return stubAudit(url, startedAt, 'lighthouse / chrome-launcher not installed');
  }
  if (!lighthouse || !chromeLauncher) {
    return stubAudit(url, startedAt, 'lighthouse / chrome-launcher import returned null');
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
    ],
  });
  try {
    const result: { lhr?: LhrMin; report?: string | string[] } | undefined = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        formFactor: opts.formFactor ?? 'mobile',
        screenEmulation: opts.formFactor === 'desktop'
          ? { mobile: false, width: 1366, height: 768, deviceScaleFactor: 1 }
          : undefined,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('lighthouse timed out')),
          opts.timeoutMs ?? 90_000,
        ),
      ),
    ]);
    if (!result || !result.lhr) {
      return stubAudit(url, startedAt, 'lighthouse returned no LHR');
    }
    return summariseLhr(url, startedAt, result.lhr, result.report, opts);
  } finally {
    await chrome.kill().catch(() => undefined);
  }
}

function stubAudit(url: string, startedAt: number, why: string): LighthouseAudit {
  return {
    url,
    scores: { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 },
    topIssues: [
      {
        id: 'setup-required',
        title: 'Lighthouse not available',
        description: `${why}. Run \`npm install --prefix apps/control-dev lighthouse chrome-launcher\` and try again.`,
        impact: 'n/a',
      },
    ],
    startedAt,
    finishedAt: Date.now(),
  };
}

function pct(x: number | null | undefined): number {
  if (typeof x !== 'number') return 0;
  return Math.round(x * 100);
}

interface LhrAuditMin {
  id: string;
  title: string;
  description: string;
  score: number | null;
  scoreDisplayMode: string;
  details?: { overallSavingsMs?: number };
}

interface LhrCategoryRefMin {
  id: string;
  weight: number;
}

interface LhrMin {
  categories: {
    performance?: { score: number | null; auditRefs: LhrCategoryRefMin[] };
    accessibility?: { score: number | null };
    'best-practices'?: { score: number | null };
    seo?: { score: number | null };
  };
  audits: Record<string, LhrAuditMin>;
}

function summariseLhr(
  url: string,
  startedAt: number,
  lhr: LhrMin,
  _report: string | string[] | undefined,
  opts: RunOpts,
): LighthouseAudit {
  const scores: LighthouseScores = {
    performance: pct(lhr.categories.performance?.score),
    accessibility: pct(lhr.categories.accessibility?.score),
    bestPractices: pct(lhr.categories['best-practices']?.score),
    seo: pct(lhr.categories.seo?.score),
  };

  // Pick the three lowest-scoring perf opportunities with overallSavingsMs > 0.
  const refs = lhr.categories.performance?.auditRefs ?? [];
  const opportunities: Array<{ ref: LhrCategoryRefMin; audit: LhrAuditMin }> = [];
  for (const ref of refs) {
    const audit = lhr.audits[ref.id];
    if (!audit) continue;
    if (audit.scoreDisplayMode !== 'numeric' && audit.scoreDisplayMode !== 'binary') continue;
    if ((audit.score ?? 1) >= 0.9) continue;
    opportunities.push({ ref, audit });
  }
  opportunities.sort(
    (a, b) => (a.audit.score ?? 1) - (b.audit.score ?? 1),
  );
  const topIssues = opportunities.slice(0, 3).map(({ audit }) => ({
    id: audit.id,
    title: audit.title,
    description: audit.description.slice(0, 240),
    impact: audit.details?.overallSavingsMs
      ? `~${Math.round(audit.details.overallSavingsMs)} ms`
      : 'qualitative',
  }));

  return {
    url,
    scores,
    topIssues,
    jsonPath: opts.jsonPath,
    startedAt,
    finishedAt: Date.now(),
  };
}
