/**
 * Writes small, valid DNG files for the raw importer tests: an uncompressed
 * Bayer (or LinearRaw) image of a known scene, with ColorMatrix1,
 * AsShotNeutral, BlackLevel / WhiteLevel, crop and orientation tags. The
 * camera response is built from the same matrices the decoder inverts, so the
 * decoded pixels can be compared to the scene exactly.
 */
import { mul3, rgbSpace, type Mat3 } from '../../src/core/raw/rawColour';

export interface FixtureOptions {
  width: number;
  height: number;
  /** linear scene RGB (0..1) at pixel x, y */
  scene: (x: number, y: number) => [number, number, number];
  pattern?: [number, number, number, number]; // CFA colours row-major (0 R, 1 G, 2 B)
  colorMatrix?: Mat3; // XYZ -> camera
  neutral?: [number, number, number]; // camera neutral, green 1
  black?: number;
  white?: number;
  bps?: 16 | 12;
  orientation?: number;
  linearRaw?: boolean;
  activeArea?: [number, number, number, number];
}

export const CAMERA_MATRIX: Mat3 = [
  [0.6722, -0.0635, -0.0963],
  [-0.4287, 1.246, 0.2028],
  [-0.0908, 0.2162, 0.5668],
]; // a typical DSLR ColorMatrix (XYZ -> camera), D65

type Entry = { tag: number; type: number; values: number[] | Uint8Array | string };

export function writeDng(o: FixtureOptions): Uint8Array {
  const { width: W, height: H } = o;
  const pattern = o.pattern ?? [0, 1, 1, 2];
  const cm = o.colorMatrix ?? CAMERA_MATRIX;
  const neutral = o.neutral ?? [0.5, 1, 0.7];
  const black = o.black ?? 512;
  const bps = o.bps ?? 16;
  const white = o.white ?? (bps === 16 ? 60000 : 4000);
  const spp = o.linearRaw ? 3 : 1;
  // normalised camera-from-RGB, as the decoder builds it
  const camRgb = mul3(cm, rgbSpace('srgb').xyzFromRgb).map((row) => {
    const s = row[0] + row[1] + row[2];
    return row.map((v) => v / s);
  });
  const samples = new Uint16Array(W * H * spp);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rgb = o.scene(x, y);
      const cam = camRgb.map((row, i) => (row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]) * neutral[i]);
      const enc = (v: number) => Math.round(black + Math.max(0, Math.min(1, v)) * (white - black));
      if (o.linearRaw) for (let c = 0; c < 3; c++) samples[(y * W + x) * 3 + c] = enc(cam[c]);
      else samples[y * W + x] = enc(cam[pattern[(y % 2) * 2 + (x % 2)]]);
    }
  }
  // pixel data bytes
  let pix: Uint8Array;
  if (bps === 16) {
    pix = new Uint8Array(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      pix[2 * i] = samples[i] & 255;
      pix[2 * i + 1] = samples[i] >> 8;
    }
  } else {
    const rowBytes = Math.ceil((W * spp * 12) / 8);
    pix = new Uint8Array(rowBytes * H);
    for (let y = 0; y < H; y++) {
      let bit = y * rowBytes * 8;
      for (let i = 0; i < W * spp; i++) {
        const v = samples[y * W * spp + i];
        for (let k = 11; k >= 0; k--, bit++) if ((v >> k) & 1) pix[bit >> 3] |= 0x80 >> (bit & 7);
      }
    }
  }
  const srational = (m: number[]) => m.flatMap((v) => [Math.round(v * 10000), 10000]);
  const entries: Entry[] = [
    { tag: 254, type: 4, values: [0] },
    { tag: 256, type: 4, values: [W] },
    { tag: 257, type: 4, values: [H] },
    { tag: 258, type: 3, values: new Array(spp).fill(bps) },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [o.linearRaw ? 34892 : 32803] },
    { tag: 271, type: 2, values: 'Quvrelo' },
    { tag: 272, type: 2, values: 'Test camera' },
    { tag: 273, type: 4, values: [0] }, // patched below
    { tag: 274, type: 3, values: [o.orientation ?? 1] },
    { tag: 277, type: 3, values: [spp] },
    { tag: 278, type: 4, values: [H] },
    { tag: 279, type: 4, values: [pix.length] },
    { tag: 284, type: 3, values: [1] },
    ...(o.linearRaw ? [] : [
      { tag: 33421, type: 3, values: [2, 2] },
      { tag: 33422, type: 1, values: new Uint8Array(pattern) },
    ]),
    { tag: 50706, type: 1, values: new Uint8Array([1, 4, 0, 0]) },
    { tag: 50714, type: 4, values: [black] },
    { tag: 50717, type: 4, values: [white] },
    { tag: 50721, type: 10, values: srational(cm.flat()) },
    { tag: 50728, type: 5, values: neutral.flatMap((v) => [Math.round(v * 10000), 10000]) },
    { tag: 50778, type: 3, values: [21] },
    ...(o.activeArea ? [{ tag: 50829, type: 4, values: o.activeArea }] : []),
  ].sort((a, b) => a.tag - b.tag) as Entry[];

  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };
  const count = (e: Entry) => (typeof e.values === 'string' ? e.values.length + 1 : e.type === 5 || e.type === 10 ? e.values.length / 2 : e.values.length);
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdSize;
  const extraOffsets = new Map<Entry, number>();
  for (const e of entries) {
    const bytes = count(e) * typeSize[e.type];
    if (bytes > 4) {
      extraOffsets.set(e, extra);
      extra += bytes + (bytes & 1);
    }
  }
  const pixOffset = extra;
  const out = new Uint8Array(pixOffset + pix.length);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0], 0);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  const writeVals = (e: Entry, at: number) => {
    if (typeof e.values === 'string') {
      for (let i = 0; i < e.values.length; i++) out[at + i] = e.values.charCodeAt(i);
      return;
    }
    const v = e.tag === 273 ? [pixOffset] : Array.from(e.values);
    v.forEach((x, i) => {
      if (e.type === 1) out[at + i] = x;
      else if (e.type === 3) dv.setUint16(at + i * 2, x, true);
      else if (e.type === 4 || e.type === 5) dv.setUint32(at + i * 4, x, true);
      else if (e.type === 10) dv.setInt32(at + i * 4, x, true);
    });
  };
  entries.forEach((e, i) => {
    const p = 10 + i * 12;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, count(e), true);
    const off = extraOffsets.get(e);
    if (off !== undefined) {
      dv.setUint32(p + 8, off, true);
      writeVals(e, off);
    } else writeVals(e, p + 8);
  });
  dv.setUint32(10 + entries.length * 12, 0, true);
  out.set(pix, pixOffset);
  return out;
}
