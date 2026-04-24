/**
 * telegram.ts
 *
 * grammY-based Telegram channel. Handles:
 * - chunking long replies across multiple messages on paragraph/sentence
 *   boundaries (Telegram cap is 4096 chars; we stay under 4000),
 * - a "typing" indicator that loops every 4s while Sean is thinking,
 * - Telegram MarkdownV2 escaping,
 * - surfacing rate-limit hits in Norwegian without crashing.
 */

import { Bot, type Context } from 'grammy';
import type { Update } from 'grammy/types';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ClaudeBridge } from '../claudeBridge.js';
import { sessionManager } from '../sessionManager.js';
import { isAllowedTelegramUser } from '../security/whitelist.js';
import { rateLimiter } from '../security/rateLimit.js';

const MAX_CHUNK = 4000;
const TYPING_INTERVAL_MS = 4_000;

const bridge = new ClaudeBridge();

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!ctx.chat) return;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  if (!isAllowedTelegramUser(userId)) {
    logger.warn({ userId, chatId }, 'non-whitelisted telegram user blocked');
    return; // silent drop
  }

  const rl = rateLimiter.check(`tg:${userId}`);
  if (!rl.allowed) {
    await safeSend(ctx, `Du sender for fort. Prøv igjen om ${Math.ceil(rl.retryAfterMs / 1000)} sekunder.`);
    return;
  }

  const session = await sessionManager.getOrCreate(BigInt(chatId));
  await sessionManager.recordMessage({ sessionRowId: session.sessionRowId, role: 'user', content: text });

  const stopTyping = startTypingIndicator(ctx);
  try {
    const result = await bridge.invoke({ message: text, sessionId: session.claudeSessionId });

    if (result.sessionId && result.sessionId !== session.claudeSessionId) {
      await sessionManager.updateClaudeSessionId(session.sessionRowId, result.sessionId);
    } else {
      await sessionManager.touch(session.sessionRowId);
    }

    if (result.rateLimited) {
      await safeSend(ctx, 'Sean er sliten akkurat nå — Max-limit truffet. Prøv igjen om litt.');
      logger.warn({ chatId }, 'claude max rate limit hit');
      return;
    }

    if (result.isError || !result.text.trim()) {
      await safeSend(ctx, 'Noe gikk galt hos Sean. Prøv igjen om et øyeblikk.');
      logger.error({ err: result.errorMessage, durationMs: result.durationMs }, 'bridge returned error');
      return;
    }

    await sessionManager.recordMessage({
      sessionRowId: session.sessionRowId,
      role: 'assistant',
      content: result.text,
      durationMs: result.durationMs,
    });

    for (const chunk of chunkReply(result.text, MAX_CHUNK)) {
      await safeSend(ctx, chunk);
    }
  } catch (err) {
    logger.error({ err }, 'telegram message handler crashed');
    await safeSend(ctx, 'Sean kræsjet. Jeg ser på det.');
  } finally {
    stopTyping();
  }
});

bot.catch((err) => {
  logger.error({ err: err.error }, 'grammY error handler');
});

function startTypingIndicator(ctx: Context): () => void {
  let cancelled = false;
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return () => {};
  const tick = async () => {
    while (!cancelled) {
      try {
        await ctx.api.sendChatAction(chatId, 'typing');
      } catch (err) {
        logger.debug({ err }, 'sendChatAction failed');
      }
      await sleep(TYPING_INTERVAL_MS);
    }
  };
  void tick();
  return () => {
    cancelled = true;
  };
}

async function safeSend(ctx: Context, text: string): Promise<void> {
  try {
    // Intentionally plain text. MarkdownV2 has enough footguns that it's safer
    // to send as plain text unless/until Sean opts into explicit formatting.
    await ctx.reply(text, { link_preview_options: { is_disabled: true } });
  } catch (err) {
    logger.error({ err }, 'telegram reply failed');
  }
}

export function chunkReply(text: string, max: number): string[] {
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > max) {
    const window = remaining.slice(0, max);
    let splitAt = lastIndexBefore(window, '\n\n');
    if (splitAt < max * 0.5) splitAt = lastIndexBefore(window, '\n');
    if (splitAt < max * 0.5) splitAt = lastIndexBefore(window, /[.!?]\s/);
    if (splitAt < max * 0.5) splitAt = lastIndexBefore(window, ' ');
    if (splitAt <= 0) splitAt = max;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

function lastIndexBefore(window: string, needle: string | RegExp): number {
  if (typeof needle === 'string') {
    return window.lastIndexOf(needle) + (needle === '\n\n' || needle === '\n' ? 1 : 0);
  }
  let last = -1;
  const re = new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g');
  for (const match of window.matchAll(re)) {
    if (match.index !== undefined) last = match.index + match[0].length;
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function handleUpdate(update: Update): Promise<void> {
  await bot.handleUpdate(update);
}

export async function initTelegramBot(): Promise<void> {
  await bot.init();
  logger.info({ username: bot.botInfo.username }, 'telegram bot initialized');
}
