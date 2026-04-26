/**
 * persona.ts — fetch & cache Sean's persona for cross-model identity.
 *
 * The desktop app pulls the persona once at boot (and every hour) so it can
 * inject it via Ollama's `system` parameter when a thread is routed to a
 * local model. Backend endpoint: GET /control/persona.
 *
 * Cache rules:
 *  - First call hits the network; subsequent calls within REFRESH_INTERVAL_MS
 *    return the in-memory copy.
 *  - On network failure, we cache an empty string for a short cool-down so we
 *    don't hammer the backend, then retry.
 *  - `clearPersonaCache()` forces the next call to refetch (used by tests).
 */

import { net } from 'electron';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1h
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;   // 5 min — long enough not to thrash, short enough to recover

interface CacheEntry {
  persona: string;
  fetchedAt: number;
  ok: boolean;
}

let cache: CacheEntry | null = null;

export function clearPersonaCache(): void {
  cache = null;
}

export async function fetchPersona(
  backendUrl: string,
  bearer: string,
): Promise<string> {
  const now = Date.now();
  if (cache) {
    const ttl = cache.ok ? REFRESH_INTERVAL_MS : FAILURE_BACKOFF_MS;
    if (now - cache.fetchedAt < ttl) {
      return cache.persona;
    }
  }
  try {
    const r = await net.fetch(`${backendUrl}/control/persona`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (!r.ok) {
      cache = { persona: '', fetchedAt: now, ok: false };
      return '';
    }
    const j = (await r.json()) as { persona?: string };
    const persona = typeof j.persona === 'string' ? j.persona : '';
    cache = { persona, fetchedAt: now, ok: true };
    return persona;
  } catch {
    cache = { persona: '', fetchedAt: now, ok: false };
    return '';
  }
}
