import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { makeRequireControlToken } from './auth.js';

function mockReq(authHeader?: string): Request {
  return { header: (n: string) => (n.toLowerCase() === 'authorization' ? authHeader : undefined), ip: '127.0.0.1' } as unknown as Request;
}
function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res as Response);
  res.json = vi.fn().mockReturnValue(res as Response);
  return res as Response;
}

describe('requireControlToken', () => {
  it('rejects missing Authorization header', () => {
    const mw = makeRequireControlToken(['t1']);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects header without Bearer prefix', () => {
    const mw = makeRequireControlToken(['t1']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('t1'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects unknown token', () => {
    const mw = makeRequireControlToken(['t1']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer wrong'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('rejects when allowlist is empty', () => {
    const mw = makeRequireControlToken([]);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer anything'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it('accepts a known token', () => {
    const mw = makeRequireControlToken(['t1', 't2']);
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    mw(mockReq('Bearer t2'), res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
