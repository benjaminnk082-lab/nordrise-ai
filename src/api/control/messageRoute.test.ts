import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { makeControlMessageRouter } from './messageRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();

class FakeBridge extends EventEmitter {
  constructor(private readonly behaviour: 'success' | 'rate_limit') { super(); }
  async invoke(opts: { message: string; sessionId?: string | null }) {
    setTimeout(() => this.emit('thinking'), 1);
    setTimeout(() => this.emit('sessionId', 'claude-uuid-1'), 2);
    setTimeout(() => this.emit('partial', 'hei '), 3);
    setTimeout(() => this.emit('partial', 'der'), 4);
    if (this.behaviour === 'rate_limit') {
      return { text: '', sessionId: 'claude-uuid-1', durationMs: 10, isError: false, rateLimited: true, costUsd: 0 };
    }
    return { text: 'hei der', sessionId: 'claude-uuid-1', durationMs: 10, isError: false, rateLimited: false, costUsd: 0.001 };
  }
}

beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});
afterAll(async () => { await prisma.$disconnect(); });

function buildApp(behaviour: 'success' | 'rate_limit') {
  const app = express();
  app.use(express.json());
  const mgr = new ControlSessionManager(prisma);
  const bridge = new FakeBridge(behaviour);
  app.use('/control', makeControlMessageRouter({ mgr, makeBridge: () => bridge as any, allowedTokens: ['t1'] }));
  return app;
}

describe('POST /control/message', () => {
  it('streams partial → done frames on success', async () => {
    const res = await request(buildApp('success'))
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(res.status).toBe(200);
    const body = String(res.body);
    expect(body).toContain('event: thinking');
    expect(body).toContain('event: session');
    expect(body).toContain('event: partial');
    expect(body).toContain('event: done');
    const messages = await prisma.message.findMany({});
    expect(messages.map((m) => m.role).sort()).toEqual(['assistant', 'user']);
  });
  it('emits SSE error frame when rate-limited', async () => {
    const res = await request(buildApp('rate_limit'))
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(String(res.body)).toContain('event: error');
    expect(String(res.body)).toContain('rate_limit');
  });
  it('rejects without bearer token', async () => {
    const res = await request(buildApp('success'))
      .post('/control/message')
      .send({ controlSessionId: null, text: 'hei' });
    expect(res.status).toBe(401);
  });
});
