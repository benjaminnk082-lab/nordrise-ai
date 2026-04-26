import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../logger.js';

export type ControlTokenMiddleware = (req: Request, res: Response, next: NextFunction) => void;

function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function makeRequireControlToken(allowed: readonly string[]): ControlTokenMiddleware {
  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('Bearer ')) {
      logger.warn({ ip: req.ip, reason: 'no_bearer' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0 || allowed.length === 0) {
      logger.warn({ ip: req.ip, reason: 'empty_token_or_allowlist' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const ok = allowed.some((t) => safeEq(token, t));
    if (!ok) {
      logger.warn({ ip: req.ip, reason: 'unknown_token' }, 'control auth fail');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
