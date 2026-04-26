import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ControlSessionManager } from './controlSessionManager.js';

const prisma = new PrismaClient();
const mgr = new ControlSessionManager(prisma);

beforeEach(async () => {
  await prisma.message.deleteMany({});
  await prisma.controlSession.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ControlSessionManager', () => {
  it('creates a new session when id is null', async () => {
    const s = await mgr.getOrCreate(null);
    expect(s.isNew).toBe(true);
    expect(s.claudeSessionId).toBeNull();
    expect(typeof s.id).toBe('string');
  });
  it('returns existing session when id is given', async () => {
    const a = await mgr.getOrCreate(null);
    const b = await mgr.getOrCreate(a.id);
    expect(b.id).toBe(a.id);
    expect(b.isNew).toBe(false);
  });
  it('throws if id is given but does not exist', async () => {
    await expect(mgr.getOrCreate('does-not-exist')).rejects.toThrow();
  });
  it('records a user message under the session', async () => {
    const s = await mgr.getOrCreate(null);
    await mgr.recordMessage({ controlSessionId: s.id, role: 'user', content: 'hei' });
    const messages = await prisma.message.findMany({ where: { controlSessionId: s.id } });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.sessionId).toBeNull();
  });
  it('updates claudeSessionId and bumps lastActiveAt', async () => {
    const s = await mgr.getOrCreate(null);
    const before = (await prisma.controlSession.findUnique({ where: { id: s.id } }))!.lastActiveAt;
    await new Promise((r) => setTimeout(r, 5));
    await mgr.updateClaudeSessionId(s.id, 'claude-uuid-1');
    const row = await prisma.controlSession.findUnique({ where: { id: s.id } });
    expect(row?.claudeSessionId).toBe('claude-uuid-1');
    expect(row!.lastActiveAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
