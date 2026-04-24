/**
 * bridge-repl.ts
 *
 * Tiny CLI harness to drive ClaudeBridge manually, without HTTP or Telegram.
 * Useful for verifying that --resume works and stream parsing is clean.
 *
 * Usage: npm run bridge-repl
 *   > hello
 *   Sean: ...
 *   > what did I just say?
 *   Sean: ...
 *   (Ctrl-C to exit)
 */

import readline from 'node:readline';
import { ClaudeBridge } from '../src/claudeBridge.js';
import { logger } from '../src/logger.js';

async function main() {
  const bridge = new ClaudeBridge();
  let sessionId: string | null = null;

  bridge.on('thinking', () => process.stdout.write('Sean (thinking)...\r'));
  bridge.on('sessionId', (id) => {
    if (!sessionId) logger.info({ id }, 'new session created');
    sessionId = id;
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    new Promise<string>((resolve) => rl.question('> ', (ans) => resolve(ans)));

  console.log('bridge-repl — type a message, Ctrl-C to quit');

  while (true) {
    const msg = await ask();
    if (!msg.trim()) continue;

    const result = await bridge.invoke({ message: msg, sessionId });
    sessionId = result.sessionId || sessionId;

    process.stdout.write('\x1b[2K\r');
    if (result.isError) {
      console.error(`Sean (error): ${result.errorMessage}`);
    } else {
      console.log(`Sean: ${result.text}\n`);
    }
    logger.debug(
      { sessionId, durationMs: result.durationMs, costUsd: result.costUsd, rateLimited: result.rateLimited },
      'turn complete',
    );
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'bridge-repl crashed');
  process.exit(1);
});
