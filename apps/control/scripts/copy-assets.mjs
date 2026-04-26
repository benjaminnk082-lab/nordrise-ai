import { mkdir, cp } from 'node:fs/promises';

// Tray icons + the logo go into dist/assets so the main process can read
// them at runtime (extraResources copies dist/assets → resources/assets in
// the packaged app).
await mkdir('dist/assets', { recursive: true });
await cp('assets', 'dist/assets', { recursive: true });

process.stdout.write('Assets copied to dist/assets\n');
