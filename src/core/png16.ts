/**
 * 16 bits per channel PNG read/write (fast-png, MIT), used for 16-bit photo
 * assets in .quvrelo files and for 16-bit PNG export. The browser's own PNG
 * decoder flattens to 8 bits, so 16-bit originals are decoded here instead.
 */
import { decode, encode } from 'fast-png';
import { isPng } from './colour/embedIcc';
import type { Pixels16 } from './pixels16';

/** Bit depth from the IHDR chunk (byte 24), or 0 if this is not a PNG. */
export function pngBitDepth(bytes: Uint8Array): number {
  if (!isPng(bytes) || bytes.length < 29) return 0;
  return bytes[24];
}

/** Decode any PNG to RGBA 16-bit (8-bit and palette files are widened). */
export function decodePng16(bytes: Uint8Array): Pixels16 {
  const png = decode(bytes);
  const { width, height, channels } = png;
  const depth = png.depth;
  const n = width * height;
  const out = new Uint16Array(n * 4);
  const src = png.data as Uint8Array | Uint16Array;
  const ch = channels;
  if (png.palette) {
    // palette images: expand indices
    const pal = png.palette;
    const idx = src;
    out.fill(65535);
    for (let i = 0; i < n; i++) {
      const c = pal[idx[i]] ?? [0, 0, 0, 255];
      out[i * 4] = c[0] * 257;
      out[i * 4 + 1] = c[1] * 257;
      out[i * 4 + 2] = c[2] * 257;
      out[i * 4 + 3] = (c.length > 3 ? c[3] : 255) * 257;
    }
    return { width, height, data: out };
  }
  const scale = depth === 16 ? 1 : 65535 / ((1 << depth) - 1);
  for (let i = 0; i < n; i++) {
    const s = i * ch;
    const o = i * 4;
    if (ch >= 3) {
      out[o] = src[s] * scale;
      out[o + 1] = src[s + 1] * scale;
      out[o + 2] = src[s + 2] * scale;
      out[o + 3] = ch === 4 ? src[s + 3] * scale : 65535;
    } else {
      const g = src[s] * scale;
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = ch === 2 ? src[s + 1] * scale : 65535;
    }
  }
  return { width, height, data: out };
}

/** Encode 16-bit RGBA (or RGB when every pixel is opaque) to a 16-bit PNG. */
export function encodePng16(p: Pixels16, opts: { alpha?: boolean } = {}): Uint8Array {
  let alpha = opts.alpha ?? false;
  if (opts.alpha === undefined) for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 65535) { alpha = true; break; }
  if (alpha) return encode({ width: p.width, height: p.height, data: p.data, depth: 16, channels: 4 }, { zlib: { level: 6 } });
  const rgb = new Uint16Array(p.width * p.height * 3);
  for (let i = 0, o = 0; i < p.data.length; i += 4, o += 3) {
    rgb[o] = p.data[i];
    rgb[o + 1] = p.data[i + 1];
    rgb[o + 2] = p.data[i + 2];
  }
  return encode({ width: p.width, height: p.height, data: rgb, depth: 16, channels: 3 }, { zlib: { level: 6 } });
}
