import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../logger.js';

export async function cleanupInbox(dir: string, maxAgeMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const st = await stat(full);
      if (st.isFile() && st.mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    } catch (err) {
      logger.warn({ err, file: full }, 'inbox cleanup: failed to check/remove file');
    }
  }
  if (removed > 0) logger.info({ removed, dir }, 'inbox cleanup ran');
  return removed;
}

export function startInboxCleanupInterval(dir: string, intervalMs = 3_600_000, maxAgeMs = 7 * 86_400_000) {
  void cleanupInbox(dir, maxAgeMs);
  return setInterval(() => void cleanupInbox(dir, maxAgeMs), intervalMs);
}
