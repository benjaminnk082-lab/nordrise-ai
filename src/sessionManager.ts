/**
 * sessionManager.ts
 *
 * Maps a Telegram chat id to a Claude Code session id. Persisted in Postgres.
 * Sessions older than SESSION_TIMEOUT_HOURS are rotated (new claude session
 * on next message), so long-idle conversations don't accumulate unbounded
 * context.
 */

import type { Session } from '@prisma/client';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';

export interface ResolvedSession {
  sessionRowId: string;
  claudeSessionId: string | null;
  telegramChatId: bigint;
  isNew: boolean;
  rotated: boolean;
}

export class SessionManager {
  async getOrCreate(telegramChatId: bigint): Promise<ResolvedSession> {
    const existing = await prisma.session.findUnique({ where: { telegramChatId } });

    if (!existing) {
      const row = await prisma.session.create({ data: { telegramChatId } });
      logger.info({ telegramChatId: telegramChatId.toString() }, 'session created');
      return {
        sessionRowId: row.id,
        claudeSessionId: null,
        telegramChatId,
        isNew: true,
        rotated: false,
      };
    }

    if (this.isStale(existing)) {
      const rotated = await prisma.session.update({
        where: { id: existing.id },
        data: { claudeSessionId: null },
      });
      logger.info(
        { telegramChatId: telegramChatId.toString(), staleSinceMs: Date.now() - existing.lastActiveAt.getTime() },
        'session rotated after inactivity',
      );
      return {
        sessionRowId: rotated.id,
        claudeSessionId: null,
        telegramChatId,
        isNew: false,
        rotated: true,
      };
    }

    return {
      sessionRowId: existing.id,
      claudeSessionId: existing.claudeSessionId,
      telegramChatId,
      isNew: false,
      rotated: false,
    };
  }

  async updateClaudeSessionId(sessionRowId: string, claudeSessionId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionRowId },
      data: { claudeSessionId, lastActiveAt: new Date() },
    });
  }

  async touch(sessionRowId: string): Promise<void> {
    await prisma.session.update({
      where: { id: sessionRowId },
      data: { lastActiveAt: new Date() },
    });
  }

  async recordMessage(params: {
    sessionRowId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    durationMs?: number;
  }): Promise<void> {
    await prisma.message.create({
      data: {
        sessionId: params.sessionRowId,
        role: params.role,
        content: params.content,
        ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
      },
    });
  }

  private isStale(session: Session): boolean {
    const ageMs = Date.now() - session.lastActiveAt.getTime();
    return ageMs > config.SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
  }
}

export const sessionManager = new SessionManager();
