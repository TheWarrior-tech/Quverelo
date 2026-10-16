/**
 * Coverage masks for pixel selections (0..255 per pixel, row-major). The
 * selection itself stays a vector outline (marching ants, Boolean add /
 * subtract / intersect); these turn sampled pixels into outlines (magic wand,
 * select colour range) and implement Refine edge (smooth, shift edge,
 * feather, contrast) on the rasterised selection.
 */
import { luminance, type Pixels } from './pixels';

export type Mask = Uint8ClampedArray;

/** Separable box blur of a coverage mask (three passes approximate a gaussian of sigma ≈ radius / 2). */
export function blurMask(src: Mask, w: number, h: number, radius: number): Mask {
  if (radius < 0.5) return new Uint8ClampedArray(src);
  const sigma = radius / 2;
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let a = new Float32Array(src);
  let b = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * inv;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i];
  b = a = new Float32Array(0);
  return out;
}

export interface RefineEdge {
  /** px: rounds jagged outlines (blur then re-threshold) */
  smooth: number;
  /** px: soft edge width */
  feather: number;
  /** 0..100: hardens a soft edge back towards a crisp one */
  contrast: number;
  /** px: grow (+) or shrink (-) the selection */
  shift: number;
}

export const NO_REFINE: RefineEdge = { smooth: 0, feather: 0, contrast: 0, shift: 0 };

/**
 * Refine a coverage mask. Shift edge uses a distance-like blur/threshold, so
 * growing by N px moves a straight edge by about N px.
 */
export function refineMask(src: Mask, w: number, h: number, o: RefineEdge): Mask {
  let m: Mask = new Uint8ClampedArray(src);
  if (o.shift) {
    const r = Math.abs(o.shift);
    const b = blurMask(m, w, h, r * 2);
    // blurred straight edge crosses 50% at the edge; the 1-sigma point sits r px away
    const level = o.shift > 0 ? 255 * 0.16 : 255 * 0.84;
    for (let i = 0; i < m.length; i++) m[i] = b[i] > level ? 255 : 0;
  }
  if (o.smooth > 0) {
    const b = blurMask(m, w, h, o.smooth * 2);
    for (let i = 0; i < m.length; i++) m[i] = b[i] >= 128 ? 255 : 0;
  }
  if (o.feather > 0) m = blurMask(m, w, h, o.feather);
  if (o.contrast > 0) {
    const k = 1 + (o.contrast / 100) * 20;
    for (let i = 0; i < m.length; i++) m[i] = 128 + (m[i] - 128) * k;
  }
  return m;
}

/** Effective feather radius after contrast (the selection keeps one uniform soft edge). */
export function effectiveFeather(o: RefineEdge): number {
  if (o.feather <= 0) return 0;
  return o.feather / (1 + (o.contrast / 100) * 20);
}

export type ColorRangeMode = 'sampled' | 'highlights' | 'midtones' | 'shadows' | 'reds' | 'greens' | 'blues';

/**
 * Select colour range: coverage by colour distance to a sampled colour (with
 * a fuzziness falloff), or by tonal range / dominant channel.
 */
export function colorRangeMask(src: Pixels, mode: ColorRangeMode, sample: [number, number, number], fuzziness: number): Mask {
  const { data: d } = src;
  const out = new Uint8ClampedArray(src.width * src.height);
  const fz = Math.max(1, fuzziness);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let v: number;
    switch (mode) {
      case 'sampled': {
        const dist = Math.sqrt(((r - sample[0]) ** 2 + (g - sample[1]) ** 2 + (b - sample[2]) ** 2) / 3);
        v = 1 - (dist - fz * 0.5) / (fz * 0.5);
        break;
      }
      case 'highlights': v = (luminance(r, g, b) - 170) / 40 + 0.5; break;
      case 'shadows': v = (85 - luminance(r, g, b)) / 40 + 0.5; break;
      case 'midtones': v = 1 - Math.abs(luminance(r, g, b) - 128) / 64; break;
      case 'reds': v = (r - Math.max(g, b)) / 64; break;
      case 'greens': v = (g - Math.max(r, b)) / 64; break;
      case 'blues': v = (b - Math.max(r, g)) / 64; break;
    }
    out[p] = Math.max(0, Math.min(1, v)) * 255;
  }
  return out;
}

/** Binary (0/1) version of a coverage mask at a threshold, for outline tracing. */
export function binarize(m: Mask, threshold = 128): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = m[i] >= threshold ? 1 : 0;
  return out;
}

/** 0/1 mask to 0..255 coverage. */
export function fromBinary(b: Uint8Array): Mask {
  const out = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b[i] ? 255 : 0;
  return out;
}

export type MaskOp = 'new' | 'add' | 'subtract' | 'intersect';

export function combineMasks(a: Mask | null, b: Mask, op: MaskOp): Mask {
  if (!a || op === 'new') return new Uint8ClampedArray(b);
  const out = new Uint8ClampedArray(b.length);
  for (let i = 0; i < b.length; i++) {
    if (op === 'add') out[i] = Math.max(a[i], b[i]);
    else if (op === 'subtract') out[i] = Math.min(a[i], 255 - b[i]);
    else out[i] = Math.min(a[i], b[i]);
  }
  return out;
}

/** Fraction of fully or partly selected pixels (0..1, weighted by coverage). */
export function coverage(m: Mask): number {
  let s = 0;
  for (let i = 0; i < m.length; i++) s += m[i];
  return m.length ? s / (255 * m.length) : 0;
}

/** Bounding box of pixels at or above a coverage threshold (null when empty). */
export function maskBounds(m: Mask, w: number, h: number, threshold = 1): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (m[y * w + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
