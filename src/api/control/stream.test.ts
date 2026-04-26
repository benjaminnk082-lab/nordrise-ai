import { describe, it, expect, vi } from 'vitest';
import { writeSseFrame, openSseStream } from './stream.js';
import type { Response } from 'express';

function mockRes() {
  const writes: string[] = [];
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => { writes.push(chunk); return true; }),
    end: vi.fn(),
  } as unknown as Response & { _writes(): string[] };
  (res as any)._writes = () => writes;
  return res;
}

describe('SSE stream helpers', () => {
  it('writes a properly formatted frame', () => {
    const res = mockRes();
    writeSseFrame(res, { event: 'partial', data: { text: 'hi' } });
    const out = (res as any)._writes().join('');
    expect(out).toBe('event: partial\ndata: {"text":"hi"}\n\n');
  });
  it('openSseStream sets correct headers', () => {
    const res = mockRes();
    openSseStream(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
  });
});
