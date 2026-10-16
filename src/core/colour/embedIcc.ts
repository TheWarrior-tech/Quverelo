/**
 * Embed (and read back) an ICC profile in exported PNG and JPEG files, so the
 * colours of an Adobe RGB or Display P3 document mean the same thing in the
 * next app (and an sRGB export says so explicitly).
 *
 *  - PNG: an iCCP chunk right after IHDR (PNG 1.2 §11.3.3.3: before PLTE and
 *    IDAT, profile zlib-compressed). Any sRGB / gAMA / cHRM / iCCP chunk the
 *    encoder wrote is dropped, since the spec says iCCP and sRGB must not both
 *    be present and the profile is the authority.
 *  - JPEG: APP2 "ICC_PROFILE" markers (ICC.1 Annex B.4), split into segments
 *    of at most 65519 profile bytes, inserted after SOI / APP0 / APP1.
 *
 * Pure byte manipulation (fflate for zlib); unit-tested in tests/unit/embedIcc.test.ts.
 */
import { unzlibSync, zlibSync } from 'fflate';

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIG.every((b, i) => bytes[i] === b);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export function readPngChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error('Not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: PngChunk[] = [];
  let p = 8;
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    out.push({ type, data: bytes.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

export function writePngChunks(chunks: PngChunk[]): Uint8Array {
  const total = 8 + chunks.reduce((s, c) => s + 12 + c.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(PNG_SIG, 0);
  let p = 8;
  for (const c of chunks) {
    dv.setUint32(p, c.data.length);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = c.type.charCodeAt(i);
    out.set(c.data, p + 8);
    dv.setUint32(p + 8 + c.data.length, crc32(out, p + 4, p + 8 + c.data.length));
    p += 12 + c.data.length;
  }
  return out;
}

/** Profile name for iCCP: Latin-1, 1..79 characters. */
function iccpName(name: string): string {
  const clean = name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 79);
  return clean || 'ICC profile';
}

/** PNG bytes with the profile embedded as iCCP (replacing any colour-space chunk the encoder wrote). */
export function embedIccInPng(png: Uint8Array, profile: Uint8Array, name = 'ICC profile'): Uint8Array {
  const chunks = readPngChunks(png).filter((c) => !['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(c.type));
  const nm = iccpName(name);
  const z = zlibSync(profile, { level: 9 });
  const data = new Uint8Array(nm.length + 2 + z.length);
  for (let i = 0; i < nm.length; i++) data[i] = nm.charCodeAt(i);
  data[nm.length] = 0; // null separator
  data[nm.length + 1] = 0; // compression method 0 (deflate)
  data.set(z, nm.length + 2);
  const ihdr = chunks.findIndex((c) => c.type === 'IHDR');
  if (ihdr !== 0) throw new Error('PNG has no IHDR first');
  chunks.splice(1, 0, { type: 'iCCP', data });
  return writePngChunks(chunks);
}

/** The embedded profile of a PNG, or null. */
export function readPngIcc(png: Uint8Array): { name: string; profile: Uint8Array } | null {
  const c = readPngChunks(png).find((k) => k.type === 'iCCP');
  if (!c) return null;
  const nul = c.data.indexOf(0);
  const name = String.fromCharCode(...c.data.subarray(0, nul));
  return { name, profile: unzlibSync(c.data.subarray(nul + 2)) };
}

const ICC_SIG = [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0]; // "ICC_PROFILE\0"
const MAX_SEG = 65519; // 65535 - 2 (length) - 14 (signature + seq + count)

/** JPEG bytes with the profile as APP2 ICC_PROFILE segments (replacing any already there). */
export function embedIccInJpeg(jpeg: Uint8Array, profile: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) throw new Error('Not a JPEG file');
  // walk the header segments: keep everything, drop old ICC APP2s, insert after APP0/APP1
  const keep: Uint8Array[] = [];
  let p = 2;
  let insertAt = 0;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marker = jpeg[p + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS: entropy-coded data follows
    const len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    const seg = jpeg.subarray(p, p + 2 + len);
    const isIcc = marker === 0xe2 && ICC_SIG.every((b, i) => seg[4 + i] === b);
    if (!isIcc) {
      keep.push(seg);
      if (marker === 0xe0 || marker === 0xe1) insertAt = keep.length;
    }
    p += 2 + len;
  }
  const count = Math.ceil(profile.length / MAX_SEG);
  if (count > 255) throw new Error('ICC profile too large for JPEG');
  const icc: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const part = profile.subarray(i * MAX_SEG, Math.min(profile.length, (i + 1) * MAX_SEG));
    const len = 2 + ICC_SIG.length + 2 + part.length;
    const seg = new Uint8Array(2 + len);
    seg[0] = 0xff;
    seg[1] = 0xe2;
    seg[2] = len >> 8;
    seg[3] = len & 0xff;
    seg.set(ICC_SIG, 4);
    seg[16] = i + 1;
    seg[17] = count;
    seg.set(part, 18);
    icc.push(seg);
  }
  keep.splice(insertAt, 0, ...icc);
  const rest = jpeg.subarray(p);
  const total = 2 + keep.reduce((s, k) => s + k.length, 0) + rest.length;
  const out = new Uint8Array(total);
  out[0] = 0xff;
  out[1] = 0xd8;
  let o = 2;
  for (const k of keep) {
    out.set(k, o);
    o += k.length;
  }
  out.set(rest, o);
  return out;
}

/** The embedded profile of a JPEG (APP2 segments reassembled in order), or null. */
export function readJpegIcc(jpeg: Uint8Array): Uint8Array | null {
  if (!isJpeg(jpeg)) return null;
  const parts: { seq: number; data: Uint8Array }[] = [];
  let p = 2;
  while (p + 4 <= jpeg.length && jpeg[p] === 0xff) {
    const marker = jpeg[p + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (jpeg[p + 2] << 8) | jpeg[p + 3];
    if (marker === 0xe2 && ICC_SIG.every((b, i) => jpeg[p + 4 + i] === b)) parts.push({ seq: jpeg[p + 16], data: jpeg.subarray(p + 18, p + 2 + len) });
    p += 2 + len;
  }
  if (!parts.length) return null;
  parts.sort((a, b) => a.seq - b.seq);
  const out = new Uint8Array(parts.reduce((s, x) => s + x.data.length, 0));
  let o = 0;
  for (const x of parts) {
    out.set(x.data, o);
    o += x.data.length;
  }
  return out;
}

/** Profile description ('desc' tag, v2 textDescriptionType or v4 mluc) for naming the iCCP chunk. */
export function iccDescription(profile: Uint8Array): string | null {
  const dv = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  if (profile.length < 132) return null;
  const n = dv.getUint32(128);
  for (let i = 0; i < n; i++) {
    const o = 132 + i * 12;
    if (o + 12 > profile.length) break;
    if (dv.getUint32(o) !== 0x64657363) continue; // 'desc'
    const off = dv.getUint32(o + 4);
    const type = dv.getUint32(off);
    if (type === 0x64657363) {
      const len = dv.getUint32(off + 8);
      return String.fromCharCode(...profile.subarray(off + 12, off + 12 + Math.max(0, len - 1)));
    }
    if (type === 0x6d6c7563) {
      const recLen = dv.getUint32(off + 20);
      const strOff = dv.getUint32(off + 24);
      let s = '';
      for (let k = 0; k < recLen; k += 2) s += String.fromCharCode(dv.getUint16(off + strOff + k));
      return s;
    }
  }
  return null;
}
