#!/usr/bin/env node
/*
 * Writes copyright metadata into every photo in assets/photos/.
 *
 *     node tools/stamp-photos.mjs
 *
 * It injects an EXIF chunk into the WebP container rather than re-encoding,
 * so the pixels are untouched and the files stay byte-for-byte as sharp as
 * they were. Safe to run repeatedly: an existing EXIF chunk is replaced.
 *
 * This does not stop anyone copying a photo. It means a copied photo carries
 * its origin with it, which is what matters if you ever have to prove it.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(root, 'content/site.json'), 'utf8'));

const year = new Date().getFullYear();
const owner = site.footer.creditName.en;
const FIELDS = {
  0x010e: `${site.business.name.en} - ${site.business.address.street}, ` +
          `${site.business.address.locality}, ${site.business.address.region}, Egypt`,
  0x013b: owner,
  // EXIF ASCII is 7-bit, so "(c)" rather than a UTF-8 (c) glyph that
  // readers render as mojibake
  0x8298: `(c) ${year} ${owner} / ${site.business.name.en}. All rights reserved. ` +
          `Not licensed for reuse. ${site.business.phoneDisplay}`,
};

/* ---- build a minimal little-endian TIFF block holding ASCII tags ---- */
function buildExif(fields) {
  const tags = Object.keys(fields).map(Number).sort((a, b) => a - b);
  const HEADER = 8;
  const dirSize = 2 + tags.length * 12 + 4;
  let dataOffset = HEADER + dirSize;

  const values = tags.map(t => {
    const bytes = Buffer.from(fields[t], 'utf8');
    const withNul = Buffer.concat([bytes, Buffer.from([0])]);
    const entry = { tag: t, bytes: withNul, inline: withNul.length <= 4 };
    if (!entry.inline) { entry.offset = dataOffset; dataOffset += withNul.length + (withNul.length % 2); }
    return entry;
  });

  const out = Buffer.alloc(dataOffset);
  out.write('II', 0, 'ascii');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(HEADER, 4);
  out.writeUInt16LE(tags.length, HEADER);

  values.forEach((v, i) => {
    const at = HEADER + 2 + i * 12;
    out.writeUInt16LE(v.tag, at);
    out.writeUInt16LE(2, at + 2);              // type 2 = ASCII
    out.writeUInt32LE(v.bytes.length, at + 4); // count includes the NUL
    if (v.inline) v.bytes.copy(out, at + 8);
    else {
      out.writeUInt32LE(v.offset, at + 8);
      v.bytes.copy(out, v.offset);
    }
  });
  out.writeUInt32LE(0, HEADER + 2 + tags.length * 12); // no IFD1
  return out;
}

/* ---- walk a RIFF/WebP container ---- */
function parseChunks(buf) {
  const chunks = [];
  let p = 12; // past "RIFF" + size + "WEBP"
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    chunks.push({ id, size, body: buf.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size % 2); // chunks are padded to even length
  }
  return chunks;
}

const chunk = (id, body) => {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  const pad = body.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([head, body, pad]);
};

/* An EXIF chunk is only legal in an extended (VP8X) file, so a plain
   VP8/VP8L image has to be wrapped in one first. */
function makeVp8x(width, height, flags) {
  const b = Buffer.alloc(10);
  b.writeUInt8(flags, 0);
  b.writeUIntLE(width - 1, 4, 3);
  b.writeUIntLE(height - 1, 7, 3);
  return b;
}

function dimensions(chunks) {
  const vp8x = chunks.find(c => c.id === 'VP8X');
  if (vp8x) return { w: vp8x.body.readUIntLE(4, 3) + 1, h: vp8x.body.readUIntLE(7, 3) + 1 };
  const vp8 = chunks.find(c => c.id === 'VP8 ');
  // VP8 keyframe: 3-byte frame tag, 3-byte start code, then 14-bit w and h
  if (vp8) return { w: vp8.body.readUInt16LE(6) & 0x3fff, h: vp8.body.readUInt16LE(8) & 0x3fff };
  const vp8l = chunks.find(c => c.id === 'VP8L');
  if (vp8l) {
    const n = vp8l.body.readUInt32LE(1);
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
  }
  return null;
}

const exif = buildExif(FIELDS);
const dir = join(root, 'assets/photos');
let done = 0;

for (const name of readdirSync(dir).filter(f => f.endsWith('.webp')).sort()) {
  const path = join(dir, name);
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    console.error(`  skipped ${name} — not a WebP`);
    continue;
  }
  const chunks = parseChunks(buf);
  const dim = dimensions(chunks);
  if (!dim) { console.error(`  skipped ${name} — could not read its size`); continue; }

  const had = chunks.some(c => c.id === 'EXIF');
  const kept = chunks.filter(c => c.id !== 'EXIF' && c.id !== 'VP8X');
  const oldX = chunks.find(c => c.id === 'VP8X');
  const flags = ((oldX ? oldX.body.readUInt8(0) : 0) | 0x08) >>> 0; // 0x08 = has EXIF

  const body = Buffer.concat([
    Buffer.from('WEBP', 'ascii'),
    chunk('VP8X', makeVp8x(dim.w, dim.h, flags)),
    ...kept.map(c => chunk(c.id, c.body)),
    chunk('EXIF', exif),
  ]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  writeFileSync(path, Buffer.concat([head, body]));

  console.log(`  ${had ? 'restamped' : 'stamped  '} ${name.padEnd(34)} ${dim.w}x${dim.h}`);
  done++;
}
console.log(`\n${done} photo${done === 1 ? '' : 's'} carry copyright metadata.`);
