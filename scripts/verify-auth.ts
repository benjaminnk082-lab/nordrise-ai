/**
 * verify-auth.ts
 *
 * Runs a one-shot `claude -p` call and refuses to let the app boot
 * unless the response metadata confirms we're on the Claude Max subscription
 * (not paid per-token API).
 *
 * Exits 0 on subscription mode, non-zero otherwise.
 *
 * Invoked by docker-entrypoint.sh before node dist/gateway.js.
 */

import { spawn } from 'node:child_process';

type AuthMode = 'subscription' | 'api_billed' | 'unknown';

interface VerifyResult {
  ok: boolean;
  authMode: AuthMode;
  detail: string;
}

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  session_id?: string;
}

function hardFail(msg: string): never {
  console.error(`[verify-auth] FAIL: ${msg}`);
  process.exit(2);
}

function checkEnv() {
  if (process.env.ANTHROPIC_API_KEY) {
    hardFail(
      'ANTHROPIC_API_KEY is set in the environment. This forces paid API billing. ' +
        'Unset it and use CLAUDE_CODE_OAUTH_TOKEN instead.',
    );
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    hardFail('CLAUDE_CODE_OAUTH_TOKEN is not set. Generate one locally with `claude setup-token`.');
  }
}

function runClaude(timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'say OK', '--output-format', 'json'], {
      env: { ...process.env, ANTHROPIC_API_KEY: undefined } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

function parseResult(stdout: string): ClaudeJsonResult {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error('empty stdout from claude -p');
  // json output mode returns a single JSON object; be lenient if wrapped in noise.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < 0) throw new Error(`no JSON object in: ${trimmed.slice(0, 200)}`);
  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as ClaudeJsonResult;
}

function classify(r: ClaudeJsonResult): VerifyResult {
  if (r.is_error) {
    return { ok: false, authMode: 'unknown', detail: `claude returned is_error=true: ${r.result ?? ''}` };
  }

  const cost = r.total_cost_usd ?? r.cost_usd;

  // Subscription responses report 0 (or undefined) cost. Paid API reports > 0.
  if (cost === undefined || cost === 0) {
    return { ok: true, authMode: 'subscription', detail: 'cost_usd is 0/undefined → subscription mode' };
  }
  if (cost > 0) {
    return {
      ok: false,
      authMode: 'api_billed',
      detail: `total_cost_usd=${cost} → paid API billing detected. Abort.`,
    };
  }

  return { ok: false, authMode: 'unknown', detail: `could not determine billing mode: ${JSON.stringify(r)}` };
}

async function main() {
  checkEnv();

  const timeoutMs = Number(process.env.CLAUDE_CALL_TIMEOUT_MS ?? 60_000);
  console.log('[verify-auth] invoking `claude -p "say OK" --output-format json`...');

  let out: { stdout: string; stderr: string; code: number };
  try {
    out = await runClaude(timeoutMs);
  } catch (err) {
    hardFail(`claude invocation failed: ${(err as Error).message}`);
  }

  if (out.code !== 0) {
    hardFail(`claude exited with code ${out.code}. stderr: ${out.stderr.slice(0, 500)}`);
  }

  let parsed: ClaudeJsonResult;
  try {
    parsed = parseResult(out.stdout);
  } catch (err) {
    hardFail(`could not parse claude output: ${(err as Error).message}\nstdout: ${out.stdout.slice(0, 500)}`);
  }

  const result = classify(parsed);
  console.log(`[verify-auth] authMode=${result.authMode} detail="${result.detail}"`);

  if (!result.ok) hardFail(`refusing to boot: ${result.detail}`);

  // Expose for downstream health endpoint
  console.log('[verify-auth] OK — subscription mode confirmed');
  process.exit(0);
}

main().catch((err) => hardFail((err as Error).message));
