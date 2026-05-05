import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('src/api/control/types.ts');
const destinations = [
  resolve('apps/control/src'),
  // Phase 3 — sandbox copy. Only sync if it exists; foundation may
  // not have created it yet on a fresh checkout.
  resolve('apps/control-dev/src'),
].filter((d) => existsSync(d) || d.endsWith('apps/control/src'));

for (const destDir of destinations) {
  const dest = resolve(destDir, 'server-types.ts');
  await mkdir(destDir, { recursive: true });
  await copyFile(src, dest);
  process.stdout.write(`Synced ${src} -> ${dest}\n`);
}
