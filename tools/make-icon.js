'use strict';

/**
 * Generates build/icon.png (512x512) with no image dependencies.
 * electron-builder derives the Windows .ico and Linux icon set from it.
 *
 *   node tools/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

// --- tiny PNG encoder ---------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- drawing ------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (edge, width, d) => clamp01(0.5 - (d - edge) / width);
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded square centred in the canvas. */
function roundedSquareDistance(x, y, half, radius) {
  const dx = Math.abs(x - SIZE / 2) - (half - radius);
  const dy = Math.abs(y - SIZE / 2) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - radius;
}

function render() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;

      // Plate.
      const plate = smooth(0, 2, roundedSquareDistance(cx, cy, 240, 92));
      let r = 20;
      let g = 24;
      let b = 30;
      let a = plate;

      const dx = cx - SIZE / 2;
      const dy = cy - SIZE / 2;
      const radius = Math.hypot(dx, dy);

      // Aperture ring.
      const ring = smooth(0, 3, Math.abs(radius - 132) - 9);
      if (ring > 0) {
        r = mix(r, 77, ring);
        g = mix(g, 171, ring);
        b = mix(b, 247, ring);
        a = Math.max(a, ring * plate);
      }

      // Beam glow, then the beam core on top of it.
      const glow = clamp01(1 - Math.abs(dy) / 54) ** 2 * clamp01(1 - Math.abs(dx) / 250);
      if (glow > 0.01) {
        r = mix(r, 189, glow * 0.55);
        g = mix(g, 147, glow * 0.55);
        b = mix(b, 249, glow * 0.55);
        a = Math.max(a, glow * 0.8 * plate);
      }

      const core = smooth(0, 2.5, Math.abs(dy) - 13) * smooth(0, 6, Math.abs(dx) - 196);
      if (core > 0) {
        const t = clamp01((cx - 60) / 392);
        r = mix(r, mix(126, 240, t), core);
        g = mix(g, mix(87, 216, t), core);
        b = mix(b, mix(232, 255, t), core);
        a = Math.max(a, core * plate);
      }

      const i = (y * SIZE + x) * 4;
      rgba[i] = Math.round(clamp01(r / 255) * 255);
      rgba[i + 1] = Math.round(clamp01(g / 255) * 255);
      rgba[i + 2] = Math.round(clamp01(b / 255) * 255);
      rgba[i + 3] = Math.round(clamp01(a) * 255);
    }
  }

  return encodePng(rgba, SIZE, SIZE);
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, render());
process.stdout.write(`wrote ${out}\n`);
