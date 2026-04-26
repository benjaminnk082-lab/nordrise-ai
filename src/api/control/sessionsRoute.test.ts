import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { makeControlSessionsRouter } from './sessionsRoute.js';
import { makeControlHistoryRouter } from './historyRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();
beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
  await prisma.session.deleteMany({});
});
afterAll(async () => { await prisma.$disconnect(); });

function app() {
  const a = express();
  a.use(express.json());
  const mgr = new ControlSessionManager(prisma);
  a.use('/control', makeControlSessionsRouter({ mgr, prisma, allowedTokens: ['t1'] }));
  a.use('/control', makeControlHistoryRouter({ prisma, allowedTokens: ['t1'] }));
  return a;
}

describe('control sessions + history', () => {
  it('creates a new desktop session', async () => {
    const res = await request(app())
      .post('/control/session/new')
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.title).toMatch(/Ny tråd/);
  });
  it('lists sessions and messages', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'A' } });
    await prisma.message.create({
      data: { controlSessionId: created.id, role: 'user', content: 'hei' },
    });

    const list = await request(app())
      .get('/control/sessions')
      .set('Authorization', 'Bearer t1');
    expect(list.status).toBe(200);
    expect(list.body.sessions).toHaveLength(1);

    const msgs = await request(app())
      .get(`/control/sessions/${created.id}/messages`)
      .set('Authorization', 'Bearer t1');
    expect(msgs.status).toBe(200);
    expect(msgs.body.messages).toHaveLength(1);
    expect(msgs.body.messages[0].source).toBe('desktop');
  });
  it('returns telegram messages with source=telegram', async () => {
    const tg = await prisma.session.create({ data: { telegramChatId: BigInt(7341469970) } });
    await prisma.message.create({ data: { sessionId: tg.id, role: 'user', content: 'tg-hi' } });
    const res = await request(app())
      .get('/control/history?source=telegram&limit=10')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.messages.every((m: any) => m.source === 'telegram')).toBe(true);
  });
});
