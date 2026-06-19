// Generates the PWA home-screen icons (PNG) from code so the repo needs no binary
// design assets. Draws the same mark as public/favicon.svg: a dark tile with a teal
// "horizon" line and your dot riding it. Run: `npm run gen-icons`.
//
// Uses only Node built-ins (zlib for DEFLATE + CRC32). Outputs to public/.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public");
mkdirSync(outDir, { recursive: true });

const BG = [15, 20, 25, 255]; // #0f1419
const TEAL = [45, 212, 191, 255]; // #2dd4bf

// Render an N×N RGBA buffer of the Horizon mark.
function render(n) {
  const buf = Buffer.alloc(n * n * 4);
  const put = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };

  // background
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) put(x, y, BG);

  const lineY = Math.round(n * 0.62);
  const half = Math.max(1, Math.round(n * 0.022)); // half-thickness of the line
  const x0 = Math.round(n * 0.13);
  const x1 = Math.round(n * 0.87);
  for (let y = lineY - half; y <= lineY + half; y++)
    for (let x = x0; x <= x1; x++) put(x, y, TEAL);

  // the dot, riding the line
  const cx = Math.round(n * 0.39);
  const cy = lineY;
  const r = Math.round(n * 0.085);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, TEAL);

  return buf;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(n, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); // width
  ihdr.writeUInt32BE(n, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // filtered scanlines (filter byte 0 per row)
  const stride = n * 4;
  const raw = Buffer.alloc(n * (stride + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(outDir, name), encodePng(size, render(size)));
  console.log("wrote", name, `(${size}x${size})`);
}
