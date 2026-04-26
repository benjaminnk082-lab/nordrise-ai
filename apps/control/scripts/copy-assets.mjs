import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });
process.stdout.write('Assets copied to dist/assets\n');
