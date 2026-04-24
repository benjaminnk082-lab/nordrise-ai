import { config } from '../config.js';

export function isAllowedTelegramUser(userId: number | bigint | undefined | null): boolean {
  if (userId === undefined || userId === null) return false;
  const id = typeof userId === 'bigint' ? userId : BigInt(userId);
  return config.ALLOWED_TELEGRAM_USER_IDS.some((allowed) => allowed === id);
}
