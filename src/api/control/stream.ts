import type { Response } from 'express';
import type { SseEvent } from './types.js';

export function openSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

export function writeSseFrame(res: Response, frame: SseEvent): void {
  res.write(`event: ${frame.event}\n`);
  res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
}

export function startHeartbeat(res: Response, ms = 25_000): () => void {
  const t = setInterval(() => {
    writeSseFrame(res, { event: 'heartbeat', data: {} });
  }, ms);
  return () => clearInterval(t);
}
