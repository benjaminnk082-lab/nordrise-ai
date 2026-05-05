import { mkdir, cp, rm, stat } from 'node:fs/promises';

const src = 'renderer/out';
const dest = 'dist/renderer';

try {
  await stat(src);
} catch {
  process.stderr.write(`Renderer build output not found at ${src}. Did 'next build renderer' run?\n`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
process.stdout.write(`Copied ${src} -> ${dest}\n`);
