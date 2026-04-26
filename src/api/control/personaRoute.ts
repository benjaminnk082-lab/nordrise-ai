/**
 * personaRoute.ts — exposes Sean's persona prompt to the desktop client.
 *
 * The desktop app fetches this once at boot (and refreshes hourly) so it can
 * inject Sean's persona via Ollama's `system` parameter when a thread is
 * routed to a local model. Sean stays Sean across providers.
 *
 * Read-only. Authenticated via the same control-token middleware as the rest
 * of /control/*. Returns the raw markdown text plus a SHA-1 fingerprint so
 * clients can cheaply detect changes.
 */

import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { logger } from '../../logger.js';
import { makeRequireControlToken } from './auth.js';

export interface PersonaRouterDeps {
  allowedTokens: readonly string[];
  /** Override the persona path (used by tests). Defaults to src/prompts/sean.md. */
  personaPath?: string;
}

export function makeControlPersonaRouter(deps: PersonaRouterDeps): Router {
  const r = Router();
  const auth = makeRequireControlToken(deps.allowedTokens);
  const personaPath = deps.personaPath ?? path.resolve('src/prompts/sean.md');

  r.get('/persona', auth, async (_req, res) => {
    try {
      const content = await readFile(personaPath, 'utf8');
      const sha1 = createHash('sha1').update(content).digest('hex');
      res.json({ persona: content, sha1, length: content.length });
    } catch (err) {
      logger.warn({ err, personaPath }, 'persona read failed');
      res.status(500).json({ error: 'persona_unreadable' });
    }
  });

  return r;
}
