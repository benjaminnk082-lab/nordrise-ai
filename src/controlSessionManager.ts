import type { PrismaClient, ControlSession } from '@prisma/client';
import { logger } from './logger.js';
import { prisma } from './db.js';

export interface ResolvedControlSession {
  id: string;
  claudeSessionId: string | null;
  isNew: boolean;
}

export class ControlSessionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(id: string | null): Promise<ResolvedControlSession> {
    if (id === null) {
      const today = new Date().toISOString().slice(0, 10);
      const row = await this.prisma.controlSession.create({
        data: { title: `Ny tråd ${today}` },
      });
      logger.info({ controlSessionId: row.id }, 'control session created');
      return { id: row.id, claudeSessionId: null, isNew: true };
    }
    const row = await this.prisma.controlSession.findUnique({ where: { id } });
    if (!row) throw new Error(`control session not found: ${id}`);
    return { id: row.id, claudeSessionId: row.claudeSessionId, isNew: false };
  }

  async updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void> {
    await this.prisma.controlSession.update({
      where: { id },
      data: { claudeSessionId, lastActiveAt: new Date() },
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { lastActiveAt: new Date() } });
  }

  async recordMessage(params: {
    controlSessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    durationMs?: number;
  }): Promise<void> {
    await this.prisma.message.create({
      data: {
        controlSessionId: params.controlSessionId,
        role: params.role,
        content: params.content,
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      },
    });
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<ControlSession[]> {
    return this.prisma.controlSession.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  async rename(id: string, title: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { title } });
  }

  async archive(id: string): Promise<void> {
    await this.prisma.controlSession.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}

export const controlSessionManager = new ControlSessionManager(prisma);
