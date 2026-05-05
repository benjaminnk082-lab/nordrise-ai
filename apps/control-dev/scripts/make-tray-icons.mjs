// Generates 3 16x16 RGBA PNGs (green/yellow/red filled circles on transparent
// background) without external dependencies. Uses zlib for deflate.
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const SIZE = 16;
const RADIUS = 6.5;
const CENTER = (SIZE - 1) / 2;

// hex color -> [r,g,b]
function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const variants = [
  { name: 'green', color: hex('#3fb27f') },
  { name: 'yellow', color: hex('#e2b73c') },
  { name: 'red', color: hex('#e25b5b') },
];

function buildRGBA(color) {
  // RGBA pixel buffer with one filter byte (0 = None) per row
  const stride = SIZE * 4;
  const data = Buffer.alloc((stride + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (stride + 1);
    data[rowStart] = 0; // filter type None
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      if (dist <= RADIUS - 0.5) alpha = 255;
      else if (dist <= RADIUS + 0.5) alpha = Math.round((RADIUS + 0.5 - dist) * 255);
      const o = rowStart + 1 + x * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = alpha;
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPNG(rgbaWithFilters) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(rgbaWithFilters);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = 'assets';
await mkdir(outDir, { recursive: true });
for (const v of variants) {
  const png = buildPNG(buildRGBA(v.color));
  const path = join(outDir, `tray-${v.name}.png`);
  await writeFile(path, png);
  process.stdout.write(`Wrote ${path} (${png.length} bytes)\n`);
}
