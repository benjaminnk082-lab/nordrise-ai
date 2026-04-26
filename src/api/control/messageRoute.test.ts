import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { makeControlMessageRouter } from './messageRoute.js';
import { ControlSessionManager } from '../../controlSessionManager.js';

const prisma = new PrismaClient();

class FakeBridge extends EventEmitter {
  public lastInvoke:
    | {
        message: string;
        sessionId?: string | null;
        model?: string;
        env?: Record<string, string>;
        extraSystemPrompt?: string;
      }
    | null = null;
  constructor(private readonly behaviour: 'success' | 'rate_limit') { super(); }
  async invoke(opts: {
    message: string;
    sessionId?: string | null;
    model?: string;
    env?: Record<string, string>;
    extraSystemPrompt?: string;
  }) {
    this.lastInvoke = opts;
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
  await prisma.reaction.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});
afterAll(async () => { await prisma.$disconnect(); });

function buildApp(behaviour: 'success' | 'rate_limit') {
  const app = express();
  app.use(express.json());
  const mgr = new ControlSessionManager(prisma);
  const bridge = new FakeBridge(behaviour);
  app.use(
    '/control',
    makeControlMessageRouter({
      mgr,
      makeBridge: () => bridge as any,
      allowedTokens: ['t1'],
      prisma,
    }),
  );
  return { app, bridge };
}

describe('POST /control/message', () => {
  it('streams partial → done frames on success', async () => {
    const { app } = buildApp('success');
    const res = await request(app)
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
    const { app } = buildApp('rate_limit');
    const res = await request(app)
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
    const { app } = buildApp('success');
    const res = await request(app)
      .post('/control/message')
      .send({ controlSessionId: null, text: 'hei' });
    expect(res.status).toBe(401);
  });
  it('honors the model param when present', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei', model: 'claude-haiku-4-5' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.model).toBe('claude-haiku-4-5');
  });
  it('rejects an unknown model value', async () => {
    const { app } = buildApp('success');
    const res = await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei', model: 'gpt-4' });
    expect(res.status).toBe(400);
  });
  it('forwards connectorKeys to the bridge as env', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({
        controlSessionId: null,
        text: 'hei',
        connectorKeys: {
          FIRECRAWL_API_KEY: 'fc-secret-123',
          GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret_456',
        },
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.env).toEqual({
      FIRECRAWL_API_KEY: 'fc-secret-123',
      GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret_456',
    });
  });
  it('omits env when no connectorKeys provided', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.env).toBeUndefined();
  });

  it('forwards per-thread systemPrompt as extraSystemPrompt', async () => {
    const session = await prisma.controlSession.create({
      data: { title: 'with prompt', systemPrompt: 'svar alltid på dansk' },
    });
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: session.id, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.extraSystemPrompt).toBeDefined();
    expect(bridge.lastInvoke?.extraSystemPrompt).toContain(
      'svar alltid på dansk',
    );
  });

  it('appends recent reactions context to extraSystemPrompt (assistant-only)', async () => {
    const session = await prisma.controlSession.create({
      data: { title: 'with reactions' },
    });
    const userMsg = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'user', content: 'hva er 2+2?' },
    });
    const assistantMsg = await prisma.message.create({
      data: { controlSessionId: session.id, role: 'assistant', content: 'svaret er 4' },
    });
    // Reaction on assistant — should appear in feedback context.
    await prisma.reaction.create({
      data: { messageId: assistantMsg.id, value: 'up' },
    });
    // Reaction on user — schema allows it but our query filters by
    // role=assistant. Verify nothing leaks through.
    await prisma.reaction.create({
      data: { messageId: userMsg.id, value: 'down' },
    });

    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: session.id, text: 'follow-up' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });

    const extra = bridge.lastInvoke?.extraSystemPrompt ?? '';
    expect(extra).toContain('Nylige reaksjoner');
    expect(extra).toContain('svaret er 4');
    expect(extra).toContain('👍');
    // user content must NOT leak — assistant only.
    expect(extra).not.toContain('hva er 2+2');
  });

  it('omits extraSystemPrompt when neither systemPrompt nor reactions exist', async () => {
    const session = await prisma.controlSession.create({
      data: { title: 'plain' },
    });
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: session.id, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.extraSystemPrompt).toBeUndefined();
  });

  // ---------- Per-user Claude OAuth token ----------

  it('forwards claudeAuthToken to the bridge as CLAUDE_CODE_OAUTH_TOKEN env', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({
        controlSessionId: null,
        text: 'hei',
        claudeAuthToken: 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('omits CLAUDE_CODE_OAUTH_TOKEN from env when claudeAuthToken absent', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei' })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    // Either env is undefined (no keys at all) or it doesn't contain the
    // user-token key. The previous test for "omits env when no
    // connectorKeys provided" guarantees the undefined case; keep this
    // assertion narrow to make the contract obvious.
    expect(bridge.lastInvoke?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('combines claudeAuthToken with connectorKeys in spawn env', async () => {
    const { app, bridge } = buildApp('success');
    await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({
        controlSessionId: null,
        text: 'hei',
        claudeAuthToken: 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        connectorKeys: { FIRECRAWL_API_KEY: 'fc-secret-123' },
      })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    expect(bridge.lastInvoke?.env).toEqual({
      FIRECRAWL_API_KEY: 'fc-secret-123',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
  });

  it('rejects claudeAuthToken shorter than 20 chars (zod validation)', async () => {
    const { app } = buildApp('success');
    const res = await request(app)
      .post('/control/message')
      .set('Authorization', 'Bearer t1')
      .send({ controlSessionId: null, text: 'hei', claudeAuthToken: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 402 when REQUIRE_USER_CLAUDE_TOKEN is true and no token sent', async () => {
    // We can't mutate the loaded `config` object in-place reliably, so build
    // a tiny app that simulates the gate by reading a local override. Pull
    // the same module under test but spy on the loaded config.
    const { config } = await import('../../config.js');
    const original = config.REQUIRE_USER_CLAUDE_TOKEN;
    (config as { REQUIRE_USER_CLAUDE_TOKEN: boolean }).REQUIRE_USER_CLAUDE_TOKEN = true;
    try {
      const { app } = buildApp('success');
      const res = await request(app)
        .post('/control/message')
        .set('Authorization', 'Bearer t1')
        .send({ controlSessionId: null, text: 'hei' });
      expect(res.status).toBe(402);
      expect(res.body).toEqual({ error: 'user_token_required' });
    } finally {
      (config as { REQUIRE_USER_CLAUDE_TOKEN: boolean }).REQUIRE_USER_CLAUDE_TOKEN = original;
    }
  });

  it('accepts the call with REQUIRE_USER_CLAUDE_TOKEN=true if claudeAuthToken is present', async () => {
    const { config } = await import('../../config.js');
    const original = config.REQUIRE_USER_CLAUDE_TOKEN;
    (config as { REQUIRE_USER_CLAUDE_TOKEN: boolean }).REQUIRE_USER_CLAUDE_TOKEN = true;
    try {
      const { app, bridge } = buildApp('success');
      const res = await request(app)
        .post('/control/message')
        .set('Authorization', 'Bearer t1')
        .send({
          controlSessionId: null,
          text: 'hei',
          claudeAuthToken: 'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        })
        .buffer(true)
        .parse((res, cb) => {
          let data = '';
          res.on('data', (c) => (data += c.toString()));
          res.on('end', () => cb(null, data));
        });
      expect(res.status).toBe(200);
      expect(bridge.lastInvoke?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe(
        'sk-ant-oat01-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    } finally {
      (config as { REQUIRE_USER_CLAUDE_TOKEN: boolean }).REQUIRE_USER_CLAUDE_TOKEN = original;
    }
  });
});
