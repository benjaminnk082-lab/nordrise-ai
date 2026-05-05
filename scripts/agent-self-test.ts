/**
 * agent-self-test — Phase 3 canary harness.
 *
 * 9 canaries, one per spec feature. Each is a pure-Node async function that
 * exercises a single feature module's surface (vault paths, SKILL.md parse,
 * checkpoint round-trip, …). Heavy / Electron-only canaries (heartbeat tick,
 * Lighthouse run, e2e smoke) report `SKIP` in `--unit` mode and run only
 * when `--e2e` is passed.
 *
 * Run from repo root:
 *   npm run agent:self-test           # --unit (commit gate)
 *   npm run agent:self-test -- --e2e  # release gate (boots Electron via Playwright)
 *
 * Output: a final exit code that's 0 iff all NON-skipped canaries passed.
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CanaryStatus = 'pass' | 'fail' | 'skip';
interface CanaryResult {
  name: string;
  status: CanaryStatus;
  detail?: string;
  durationMs?: number;
}

const args = new Set(process.argv.slice(2));
const isE2E = args.has('--e2e');

async function runCanary(
  name: string,
  fn: () => Promise<CanaryResult> | CanaryResult,
): Promise<CanaryResult> {
  const started = Date.now();
  try {
    const r = await fn();
    return { ...r, name, durationMs: Date.now() - started };
  } catch (err) {
    return {
      name,
      status: 'fail',
      detail: (err as Error).message,
      durationMs: Date.now() - started,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Canary 1 — Vault path detect + atomic write round-trip
// ─────────────────────────────────────────────────────────────────────
async function canary1Vault(): Promise<CanaryResult> {
  const { detectVaultCandidates, atomicWrite } = await import(
    '../apps/control-dev/main/lib/vaultPaths.js'
  );
  // Detect — should not throw even if no vault exists; returns [].
  const cands = await detectVaultCandidates();
  if (!Array.isArray(cands)) {
    return { name: '', status: 'fail', detail: 'detectVaultCandidates did not return array' };
  }
  // Atomic write — write to a tmp dir, verify content lands and tmp is gone.
  const dir = mkdtempSync(join(tmpdir(), 'sean-vault-'));
  try {
    const target = join(dir, 'memories.md');
    await atomicWrite(target, '# hello vault\n');
    const got = readFileSync(target, 'utf8');
    if (got !== '# hello vault\n') {
      return {
        name: '',
        status: 'fail',
        detail: `read-back mismatch: got ${JSON.stringify(got)}`,
      };
    }
    if (existsSync(target + '.tmp')) {
      return { name: '', status: 'fail', detail: 'leftover .tmp file after rename' };
    }
    return { name: '', status: 'pass', detail: `${cands.length} vault candidate(s) on disk` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Canary 2 — SKILL.md frontmatter parse
// ─────────────────────────────────────────────────────────────────────
async function canary2Skill(): Promise<CanaryResult> {
  const { parseSkill } = await import(
    '../apps/control-dev/main/lib/skillsLoader.js'
  );
  const sample = [
    '---',
    'name: web-research',
    'description: Browse the web for current information.',
    'when_to_use: When the user asks about external/current facts.',
    'required_tools:',
    '  - firecrawl_scrape',
    '  - firecrawl_search',
    'files:',
    '  - research-template.md',
    '---',
    '# Skill body',
    'Use Firecrawl to look things up.',
    '',
  ].join('\n');
  const skill = parseSkill(sample);
  if (skill.name !== 'web-research') {
    return { name: '', status: 'fail', detail: `name mismatch: ${skill.name}` };
  }
  if (!Array.isArray(skill.required_tools) || skill.required_tools.length !== 2) {
    return { name: '', status: 'fail', detail: 'required_tools not parsed' };
  }
  if (!skill.body.includes('# Skill body')) {
    return { name: '', status: 'fail', detail: 'body missing' };
  }
  return { name: '', status: 'pass' };
}

// ─────────────────────────────────────────────────────────────────────
// Canary 3 — Heartbeat tick (e2e only — needs gateway round-trip)
// ─────────────────────────────────────────────────────────────────────
async function canary3Heartbeat(): Promise<CanaryResult> {
  if (!isE2E) return { name: '', status: 'skip', detail: 'e2e-only' };
  const { buildHeartbeatPrompt } = await import(
    '../apps/control-dev/main/lib/heartbeat.js'
  );
  const sampleHeartbeat = [
    '# Heartbeat',
    '- [ ] Sjekk om vault-sync har stoppet',
    '- [x] Skim `src/prompts/sean.md`',
  ].join('\n');
  const prompt = buildHeartbeatPrompt(sampleHeartbeat);
  if (!prompt || typeof prompt !== 'string' || !prompt.includes('HEARTBEAT_OK')) {
    return { name: '', status: 'fail', detail: 'prompt missing sentinel reference' };
  }
  return { name: '', status: 'pass' };
}

// ─────────────────────────────────────────────────────────────────────
// Canary 4 — Token usage parse from stream-json `result` event
// ─────────────────────────────────────────────────────────────────────
async function canary4Cost(): Promise<CanaryResult> {
  const { parseUsageFromResult } = await import(
    '../apps/control-dev/main/lib/costTracker.js'
  );
  const sample = {
    type: 'result',
    subtype: 'success',
    session_id: 'abc',
    total_cost_usd: 0.0123,
    usage: { input_tokens: 1240, output_tokens: 387 },
  };
  const usage = parseUsageFromResult(sample);
  if (usage.inputTokens !== 1240 || usage.outputTokens !== 387) {
    return { name: '', status: 'fail', detail: `tokens off: ${JSON.stringify(usage)}` };
  }
  if (Math.abs(usage.costUsd - 0.0123) > 1e-6) {
    return { name: '', status: 'fail', detail: 'cost mismatch' };
  }
  return { name: '', status: 'pass' };
}

// ─────────────────────────────────────────────────────────────────────
// Canary 5 — Checkpoint create + rollback round-trip
// ─────────────────────────────────────────────────────────────────────
async function canary5Checkpoint(): Promise<CanaryResult> {
  const { createCheckpoint, rollbackCheckpoint, isGitRepo } = await import(
    '../apps/control-dev/main/lib/checkpoint.js'
  );
  const dir = mkdtempSync(join(tmpdir(), 'sean-ckpt-'));
  try {
    // Non-git fallback path: write a file, checkpoint, mutate, rollback.
    if (await isGitRepo(dir)) {
      throw new Error('tmpdir unexpectedly a git repo');
    }
    writeFileSync(join(dir, 'a.txt'), 'first', 'utf8');
    const ckpt = await createCheckpoint(dir, 'canary');
    writeFileSync(join(dir, 'a.txt'), 'second', 'utf8');
    const restored = await rollbackCheckpoint(dir, ckpt.id);
    if (!restored.ok) {
      return { name: '', status: 'fail', detail: `rollback rejected: ${restored.error}` };
    }
    const content = readFileSync(join(dir, 'a.txt'), 'utf8');
    if (content !== 'first') {
      return { name: '', status: 'fail', detail: `rollback content mismatch: ${content}` };
    }
    return { name: '', status: 'pass' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Canary 6 — Lighthouse run (e2e only — needs Chrome on PATH)
// ─────────────────────────────────────────────────────────────────────
async function canary6Lighthouse(): Promise<CanaryResult> {
  if (!isE2E) return { name: '', status: 'skip', detail: 'e2e-only (needs Chrome)' };
  const { runLighthouse } = await import(
    '../apps/control-dev/main/lib/lighthouseRunner.js'
  );
  const result = await runLighthouse('https://example.com', { timeoutMs: 60_000 });
  if (
    typeof result.scores?.performance !== 'number' ||
    typeof result.scores?.accessibility !== 'number'
  ) {
    return { name: '', status: 'fail', detail: 'scores missing' };
  }
  return { name: '', status: 'pass' };
}

// ─────────────────────────────────────────────────────────────────────
// Canary 7 — Preview port-detect heuristic
// ─────────────────────────────────────────────────────────────────────
async function canary7Preview(): Promise<CanaryResult> {
  const { isLikelyDevServerPort, scanCommonDevPorts } = await import(
    '../apps/control-dev/main/lib/previewPorts.js'
  );
  if (!isLikelyDevServerPort(3000) || !isLikelyDevServerPort(5173) || !isLikelyDevServerPort(8080)) {
    return { name: '', status: 'fail', detail: 'common dev ports rejected' };
  }
  if (isLikelyDevServerPort(22) || isLikelyDevServerPort(443)) {
    return { name: '', status: 'fail', detail: 'system port accepted' };
  }
  // Smoke-scan: should not throw (every port unbound on a clean machine).
  const open = await scanCommonDevPorts({ timeoutMs: 200 });
  if (!Array.isArray(open)) {
    return { name: '', status: 'fail', detail: 'scan returned non-array' };
  }
  return { name: '', status: 'pass', detail: `${open.length} dev port(s) reachable now` };
}

// ─────────────────────────────────────────────────────────────────────
// Canary 8 — Retry helper backoff + errors.md append
// ─────────────────────────────────────────────────────────────────────
async function canary8Robustness(): Promise<CanaryResult> {
  const { withRetry, appendErrorLog } = await import(
    '../apps/control-dev/main/lib/robustness.js'
  );
  // Backoff: counts attempts, fails the first 2, succeeds on the 3rd.
  let calls = 0;
  const t0 = Date.now();
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('synthetic transient');
      return 'ok';
    },
    { maxAttempts: 3, baseMs: 50 },
  );
  const elapsed = Date.now() - t0;
  if (result !== 'ok' || calls !== 3) {
    return { name: '', status: 'fail', detail: `wrong call count: ${calls}` };
  }
  if (elapsed < 100) {
    // baseMs=50 → backoff sleeps ~50+100=150ms minimum
    return { name: '', status: 'fail', detail: `backoff too short: ${elapsed}ms` };
  }
  // errors.md append round-trip in a tmp dir.
  const dir = mkdtempSync(join(tmpdir(), 'sean-err-'));
  try {
    const file = join(dir, 'errors.md');
    await appendErrorLog(file, {
      level: 'error',
      message: 'canary synthetic',
      stack: 'no stack',
      context: { canary: 8 },
    });
    const txt = readFileSync(file, 'utf8');
    if (!txt.includes('canary synthetic') || !txt.includes('"canary": 8')) {
      return { name: '', status: 'fail', detail: 'errors.md content missing fields' };
    }
    return { name: '', status: 'pass' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Canary 9 — End-to-end smoke (e2e only)
// ─────────────────────────────────────────────────────────────────────
async function canary9E2E(): Promise<CanaryResult> {
  if (!isE2E) return { name: '', status: 'skip', detail: 'e2e-only (boots Playwright)' };
  return { name: '', status: 'skip', detail: 'TODO Playwright Electron harness' };
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const canaries = [
    { num: 1, name: 'F1 Vault (paths + atomic write)', run: canary1Vault },
    { num: 2, name: 'F2 Skill parse', run: canary2Skill },
    { num: 3, name: 'F3 Heartbeat tick', run: canary3Heartbeat },
    { num: 4, name: 'F4 Token usage parse', run: canary4Cost },
    { num: 5, name: 'F5 Checkpoint round-trip', run: canary5Checkpoint },
    { num: 6, name: 'F6 Lighthouse run', run: canary6Lighthouse },
    { num: 7, name: 'F7 Preview port-detect', run: canary7Preview },
    { num: 8, name: 'F8 Retry + error log', run: canary8Robustness },
    { num: 9, name: 'F9 E2E smoke', run: canary9E2E },
  ] as const;

  process.stdout.write(`Sean self-test (${isE2E ? 'e2e' : 'unit'})\n`);
  process.stdout.write('─'.repeat(60) + '\n');

  const results: CanaryResult[] = [];
  for (const c of canaries) {
    const r = await runCanary(c.name, c.run);
    results.push(r);
    const icon = r.status === 'pass' ? '✓' : r.status === 'skip' ? '–' : '✗';
    const time = r.durationMs !== undefined ? ` (${r.durationMs}ms)` : '';
    const detail = r.detail ? ` — ${r.detail}` : '';
    process.stdout.write(`${icon} ${c.num}. ${r.name}${time}${detail}\n`);
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  process.stdout.write('─'.repeat(60) + '\n');
  process.stdout.write(
    `${passed} passed, ${failed} failed, ${skipped} skipped (${results.length} total)\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

void main();
