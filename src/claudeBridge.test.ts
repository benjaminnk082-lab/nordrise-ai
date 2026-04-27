import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// Capture the spawn args (esp. env) without actually launching `claude`.
const spawnSpy = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

import { ClaudeBridge } from './claudeBridge.js';

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  kill: (sig?: NodeJS.Signals) => void;
  killed: boolean;
}

function makeFakeChild(events: string[]): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = Readable.from((async function* () {
    for (const line of events) {
      yield line + '\n';
    }
  })());
  child.stderr = Readable.from((async function* () {
    // empty
  })());
  child.kill = () => {};
  child.killed = false;
  // Schedule a 'close' on next tick after the stream drains.
  process.nextTick(() => {
    setTimeout(() => child.emit('close', 0), 5);
  });
  return child;
}

beforeEach(() => {
  spawnSpy.mockReset();
});

afterEach(() => {
  // Tests in this file may set ANTHROPIC_API_KEY to verify it's stripped on
  // spawn. Single-fork pool means we MUST clean it up so config.ts in other
  // suites (which throws if the var is present) keeps working.
  delete process.env.ANTHROPIC_API_KEY;
});

describe('ClaudeBridge.invoke env passthrough', () => {
  it('spreads opts.env into spawn env after sanitizedEnv strips ANTHROPIC_API_KEY', async () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-1' }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: 'sid-1',
        is_error: false,
        total_cost_usd: 0,
        duration_ms: 1,
      }),
    ];
    spawnSpy.mockImplementation(() => makeFakeChild(events));

    process.env.ANTHROPIC_API_KEY = 'should-be-stripped';

    // Use a non-existent prompt path so loadPrompt falls back to empty.
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    await bridge.invoke({
      message: 'hei',
      env: {
        FIRECRAWL_API_KEY: 'fc-test',
        GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp-test',
      },
    });

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const call = spawnSpy.mock.calls[0]!;
    const spawnOpts = call[2] as { env: NodeJS.ProcessEnv };
    expect(spawnOpts.env.FIRECRAWL_API_KEY).toBe('fc-test');
    expect(spawnOpts.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp-test');
    // sanitizedEnv() should still strip ANTHROPIC_API_KEY.
    expect(spawnOpts.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('works without opts.env (no connector keys)', async () => {
    const events = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-2' }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'ok',
        session_id: 'sid-2',
        is_error: false,
        total_cost_usd: 0,
        duration_ms: 1,
      }),
    ];
    spawnSpy.mockImplementation(() => makeFakeChild(events));

    const bridge = new ClaudeBridge('/no/such/prompt.md');
    await bridge.invoke({ message: 'hei' });

    const spawnOpts = spawnSpy.mock.calls[0]![2] as { env: NodeJS.ProcessEnv };
    expect(spawnOpts.env.FIRECRAWL_API_KEY).toBeUndefined();
    expect(spawnOpts.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBeUndefined();
  });
});

describe('ClaudeBridge.invoke extraSystemPrompt', () => {
  const successEvents = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-x' }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      session_id: 'sid-x',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 1,
    }),
  ];

  it('appends extraSystemPrompt with persona when persona is empty', async () => {
    spawnSpy.mockImplementation(() => makeFakeChild(successEvents));

    // Empty persona path → cachedPrompt stays empty.
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    await bridge.invoke({
      message: 'hei',
      extraSystemPrompt: 'svar alltid på engelsk',
    });

    const args = spawnSpy.mock.calls[0]![1] as string[];
    const idx = args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('svar alltid på engelsk');
  });

  it('passes persona alone when extraSystemPrompt is undefined / empty', async () => {
    spawnSpy.mockImplementation(() => makeFakeChild(successEvents));
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    await bridge.invoke({ message: 'hei', extraSystemPrompt: '   ' });
    const args = spawnSpy.mock.calls[0]![1] as string[];
    // No persona file → no --append-system-prompt at all.
    expect(args.indexOf('--append-system-prompt')).toBe(-1);
  });
});

describe('ClaudeBridge.invoke selfCritique', () => {
  function makeResultEvents(text: string) {
    return [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-c' }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: text,
        session_id: 'sid-c',
        is_error: false,
        total_cost_usd: 0,
        duration_ms: 1,
      }),
    ];
  }

  it('does NOT run critique pass for short replies (≤ 500 chars)', async () => {
    const shortText = 'kort svar';
    spawnSpy.mockImplementation(() => makeFakeChild(makeResultEvents(shortText)));
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    const result = await bridge.invoke({
      message: 'hei',
      selfCritique: true,
    });
    expect(result.text).toBe(shortText);
    // Only the original spawn — no critique.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('runs critique pass on long replies and substitutes refined text', async () => {
    const longDraft = 'a'.repeat(600);
    const refined = 'b'.repeat(200);
    let calls = 0;
    spawnSpy.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return makeFakeChild(makeResultEvents(longDraft));
      return makeFakeChild(makeResultEvents(refined));
    });
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    const result = await bridge.invoke({
      message: 'fortell meg en lang historie',
      selfCritique: true,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    // The second call must use Haiku regardless of the original model.
    const secondArgs = spawnSpy.mock.calls[1]![1] as string[];
    const modelIdx = secondArgs.indexOf('--model');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(secondArgs[modelIdx + 1]).toBe('claude-haiku-4-5');
    expect(result.text).toBe(refined);
  });

  it('keeps original draft when critique returns too-short text', async () => {
    const longDraft = 'a'.repeat(600);
    const tooShort = 'no';
    let calls = 0;
    spawnSpy.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return makeFakeChild(makeResultEvents(longDraft));
      return makeFakeChild(makeResultEvents(tooShort));
    });
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    const result = await bridge.invoke({
      message: 'fortell meg en lang historie',
      selfCritique: true,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(longDraft);
  });

  it('does NOT recurse: critique pass uses selfCritique=false internally', async () => {
    // Two long replies in a row would loop forever if recursion happened.
    const longDraft = 'x'.repeat(700);
    const longRefined = 'y'.repeat(700);
    let calls = 0;
    spawnSpy.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return makeFakeChild(makeResultEvents(longDraft));
      return makeFakeChild(makeResultEvents(longRefined));
    });
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    const result = await bridge.invoke({
      message: 'fortell meg en lang historie',
      selfCritique: true,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(longRefined);
  });

  it('skips critique when selfCritique is false', async () => {
    const longDraft = 'q'.repeat(800);
    spawnSpy.mockImplementation(() => makeFakeChild(makeResultEvents(longDraft)));
    const bridge = new ClaudeBridge('/no/such/prompt.md');
    const result = await bridge.invoke({
      message: 'fortell meg en lang historie',
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(longDraft);
  });
});
