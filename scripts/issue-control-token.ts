import { randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('hex');
process.stdout.write(`\nNew control API token (32 bytes hex):\n\n  ${token}\n\n`);
process.stdout.write('Add it to Railway:\n');
process.stdout.write(`  railway variables --set CONTROL_API_TOKENS="<existing>,${token}"\n\n`);
process.stdout.write('Then paste it into the desktop app onboarding screen.\n');
