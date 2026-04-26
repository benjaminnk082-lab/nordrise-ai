import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const src = resolve('src/api/control/types.ts');
const destDir = resolve('apps/control/src');
const dest = resolve(destDir, 'server-types.ts');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
process.stdout.write(`Synced ${src} -> ${dest}\n`);
