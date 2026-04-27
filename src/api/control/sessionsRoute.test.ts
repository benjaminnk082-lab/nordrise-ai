import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { makeControlSessionsRouter } from './sessionsRoute.js';
import { makeControlHistoryRouter } from './historyRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();
beforeEach(async () => {
  await prisma.reaction.deleteMany({});
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
  it('persists a manually posted message via POST /sessions/:id/messages', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'M' } });
    const res = await request(app())
      .post(`/control/sessions/${created.id}/messages`)
      .set('Authorization', 'Bearer t1')
      .send({ role: 'user', content: 'fra ollama', model: 'qwen2.5-coder:14b' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const rows = await prisma.message.findMany({ where: { controlSessionId: created.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('user');
  });
  it('returns 404 when posting to missing session', async () => {
    const res = await request(app())
      .post('/control/sessions/missing/messages')
      .set('Authorization', 'Bearer t1')
      .send({ role: 'user', content: 'x' });
    expect(res.status).toBe(404);
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

  it('PATCH /sessions/:id sets and clears systemPrompt', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'P' } });

    // Set
    const setRes = await request(app())
      .patch(`/control/sessions/${created.id}`)
      .set('Authorization', 'Bearer t1')
      .send({ systemPrompt: 'svar kort og direkte' });
    expect(setRes.status).toBe(200);
    let row = await prisma.controlSession.findUnique({ where: { id: created.id } });
    expect(row?.systemPrompt).toBe('svar kort og direkte');

    // Clear via null
    const clearRes = await request(app())
      .patch(`/control/sessions/${created.id}`)
      .set('Authorization', 'Bearer t1')
      .send({ systemPrompt: null });
    expect(clearRes.status).toBe(200);
    row = await prisma.controlSession.findUnique({ where: { id: created.id } });
    expect(row?.systemPrompt).toBeNull();

    // Empty string also clears
    await prisma.controlSession.update({
      where: { id: created.id },
      data: { systemPrompt: 'noe' },
    });
    const clearEmpty = await request(app())
      .patch(`/control/sessions/${created.id}`)
      .set('Authorization', 'Bearer t1')
      .send({ systemPrompt: '   ' });
    expect(clearEmpty.status).toBe(200);
    row = await prisma.controlSession.findUnique({ where: { id: created.id } });
    expect(row?.systemPrompt).toBeNull();
  });

  it('PATCH /sessions/:id rejects empty body', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'P' } });
    const res = await request(app())
      .patch(`/control/sessions/${created.id}`)
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(400);
  });

  it('PATCH /sessions/:id still supports rename', async () => {
    const created = await prisma.controlSession.create({ data: { title: 'old' } });
    const res = await request(app())
      .patch(`/control/sessions/${created.id}`)
      .set('Authorization', 'Bearer t1')
      .send({ title: 'ny tittel' });
    expect(res.status).toBe(200);
    const row = await prisma.controlSession.findUnique({ where: { id: created.id } });
    expect(row?.title).toBe('ny tittel');
  });

  it('lists sessions with systemPrompt field included', async () => {
    await prisma.controlSession.create({
      data: { title: 'A', systemPrompt: 'be brief' },
    });
    const res = await request(app())
      .get('/control/sessions')
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].systemPrompt).toBe('be brief');
  });

  it('POST /messages/:id/reaction upserts and includes reaction in GET', async () => {
    const session = await prisma.controlSession.create({ data: { title: 'R' } });
    const msg = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'assistant', content: 'svar' },
    });

    // First POST creates
    let res = await request(app())
      .post(`/control/messages/${msg.id}/reaction`)
      .set('Authorization', 'Bearer t1')
      .send({ value: 'up' });
    expect(res.status).toBe(200);

    // Second POST updates value (upsert)
    res = await request(app())
      .post(`/control/messages/${msg.id}/reaction`)
      .set('Authorization', 'Bearer t1')
      .send({ value: 'down' });
    expect(res.status).toBe(200);

    const row = await prisma.reaction.findUnique({ where: { messageId: msg.id } });
    expect(row?.value).toBe('down');

    // GET messages includes reaction value
    const list = await request(app())
      .get(`/control/sessions/${session.id}/messages`)
      .set('Authorization', 'Bearer t1');
    expect(list.body.messages[0].reaction).toBe('down');
  });

  it('DELETE /messages/:id/reaction is idempotent', async () => {
    const session = await prisma.controlSession.create({ data: { title: 'R' } });
    const msg = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'assistant', content: 'svar' },
    });
    await prisma.reaction.create({ data: { messageId: msg.id, value: 'up' } });

    const res1 = await request(app())
      .delete(`/control/messages/${msg.id}/reaction`)
      .set('Authorization', 'Bearer t1');
    expect(res1.status).toBe(200);
    expect(await prisma.reaction.findUnique({ where: { messageId: msg.id } })).toBeNull();

    // second call still ok
    const res2 = await request(app())
      .delete(`/control/messages/${msg.id}/reaction`)
      .set('Authorization', 'Bearer t1');
    expect(res2.status).toBe(200);
  });

  it('POST reaction with invalid value returns 400', async () => {
    const session = await prisma.controlSession.create({ data: { title: 'R' } });
    const msg = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'assistant', content: 'x' },
    });
    const res = await request(app())
      .post(`/control/messages/${msg.id}/reaction`)
      .set('Authorization', 'Bearer t1')
      .send({ value: 'meh' });
    expect(res.status).toBe(400);
  });

  it('POST reaction on non-existent message returns 404', async () => {
    const res = await request(app())
      .post('/control/messages/missing/reaction')
      .set('Authorization', 'Bearer t1')
      .send({ value: 'up' });
    expect(res.status).toBe(404);
  });

  it('POST /messages/:id/pin toggles, GET /messages/pinned lists', async () => {
    const session = await prisma.controlSession.create({ data: { title: 'Pinning' } });
    const a = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'user', content: 'hei' },
    });
    const b = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'assistant', content: 'svar' },
    });

    // Initial state: not pinned
    let row = await prisma.message.findUnique({ where: { id: a.id } });
    expect(row?.pinned).toBe(false);

    // First toggle pins
    let res = await request(app())
      .post(`/control/messages/${a.id}/pin`)
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, pinned: true });

    // Second toggle unpins
    res = await request(app())
      .post(`/control/messages/${a.id}/pin`)
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, pinned: false });

    // Pin both, verify list includes them with sessionTitle
    await request(app())
      .post(`/control/messages/${a.id}/pin`)
      .set('Authorization', 'Bearer t1')
      .send({});
    await request(app())
      .post(`/control/messages/${b.id}/pin`)
      .set('Authorization', 'Bearer t1')
      .send({});

    const list = await request(app())
      .get('/control/messages/pinned')
      .set('Authorization', 'Bearer t1');
    expect(list.status).toBe(200);
    expect(list.body.pinned).toHaveLength(2);
    expect(list.body.pinned.every((p: any) => p.sessionTitle === 'Pinning')).toBe(true);
  });

  it('POST /messages/:id/pin on missing message returns 404', async () => {
    const res = await request(app())
      .post('/control/messages/missing-id/pin')
      .set('Authorization', 'Bearer t1')
      .send({});
    expect(res.status).toBe(404);
  });

  it('GET /sessions/:id/messages includes pinned and controlSessionId', async () => {
    const session = await prisma.controlSession.create({ data: { title: 'P' } });
    const m = await prisma.message.create({
      data: {
        controlSessionId: session.id,
        role: 'assistant',
        content: 'hei',
        pinned: true,
      },
    });
    const res = await request(app())
      .get(`/control/sessions/${session.id}/messages`)
      .set('Authorization', 'Bearer t1');
    expect(res.status).toBe(200);
    expect(res.body.messages[0].pinned).toBe(true);
    expect(res.body.messages[0].controlSessionId).toBe(session.id);
    expect(res.body.messages[0].id).toBe(m.id);
  });
});
