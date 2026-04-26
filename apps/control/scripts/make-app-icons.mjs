// Generate the installer .ico (multi-resolution) and the in-app logo.png
// from the source PNG that the user committed under apps/control/assets.
//
// Inputs:
//   apps/control/assets/2921975f-65c2-4968-aaef-af0ba776a5a7.png
// Outputs:
//   apps/installer/assets/nordrise-icon.ico   (16/32/48/64/128/256)
//   apps/control/assets/logo.png              (256x256, used by renderer)
//
// Idempotent — safe to re-run. Run via: node scripts/make-app-icons.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import toIco from 'to-ico';

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'assets', '2921975f-65c2-4968-aaef-af0ba776a5a7.png');
const ICO_OUT = resolve(ROOT, '..', 'installer', 'assets', 'nordrise-icon.ico');
const LOGO_OUT = resolve(ROOT, 'assets', 'logo.png');

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  // Render multi-resolution PNGs from the source, fitting it into a square
  // canvas with transparency (in case the source isn't already square).
  const buffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(SRC)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    ),
  );

  await mkdir(dirname(ICO_OUT), { recursive: true });
  const ico = await toIco(buffers);
  await writeFile(ICO_OUT, ico);
  process.stdout.write(`wrote ${ICO_OUT} (${ico.byteLength} bytes)\n`);

  // Renderer logo — single 256x256 PNG with transparent padding.
  await mkdir(dirname(LOGO_OUT), { recursive: true });
  const logo = await sharp(SRC)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await writeFile(LOGO_OUT, logo);
  process.stdout.write(`wrote ${LOGO_OUT} (${logo.byteLength} bytes)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
