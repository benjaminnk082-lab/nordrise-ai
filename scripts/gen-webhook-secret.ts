/**
 * Generate a random 32-byte hex string, suitable for TELEGRAM_WEBHOOK_SECRET.
 * Usage: npm run gen-secret
 */
import { randomBytes } from 'node:crypto';
process.stdout.write(randomBytes(32).toString('hex') + '\n');
