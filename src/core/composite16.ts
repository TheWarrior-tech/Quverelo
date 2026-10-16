/**
 * Page compositor for 16-bit export: accumulates premultiplied float RGBA and
 * implements the W3C Compositing and Blending Level 1 formulas for source-over
 * with all 16 blend modes Quvrelo offers (the same ones the canvas uses on
 * screen). 16-bit photo layers are resampled into it at full precision;
 * vector and text layers arrive as 8-bit coverage from the canvas renderer
 * and are blended here, so the photo underneath keeps its 16 bits.
 *
 * Pure (no DOM); unit-tested in tests/unit/composite16.test.ts.
 */
import type { BlendMode } from './types';
import type { Matrix } from './geometry';
import { resize16, type Pixels16 } from './pixels16';

type RGB = [number, number, number];

const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColour(c: RGB): RGB {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: RGB = [...c] as RGB;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB;
  return out;
}
const setLum = (c: RGB, l: number): RGB => {
  const d = l - lum(c);
  return clipColour([c[0] + d, c[1] + d, c[2] + d]);
};
const sat = (c: RGB) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
function setSat(c: RGB, s: number): RGB {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  const out: RGB = [0, 0, 0];
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    out[mx] = s;
  }
  out[mn] = 0;
  return out;
}

function sep(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'multiply': return b * s;
    case 'screen': return b + s - b * s;
    case 'overlay': return sep('hard-light', s, b);
    case 'darken': return Math.min(b, s);
    case 'lighten': return Math.max(b, s);
    case 'color-dodge': return b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s));
    case 'color-burn': return b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    case 'hard-light': return s <= 0.5 ? b * 2 * s : sep('screen', b, 2 * s - 1);
    case 'soft-light': {
      if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
      const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
      return b + (2 * s - 1) * (d - b);
    }
    case 'difference': return Math.abs(b - s);
    case 'exclusion': return b + s - 2 * b * s;
    default: return s;
  }
}

/** B(Cb, Cs) for any mode, on unpremultiplied 0..1 colours. */
export function blendColour(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  switch (mode) {
    case 'normal': return cs;
    case 'hue': return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color': return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
    default: return [sep(mode, cb[0], cs[0]), sep(mode, cb[1], cs[1]), sep(mode, cb[2], cs[2])];
  }
}

export class Compositor16 {
  /** premultiplied RGBA, 0..1 */
  readonly acc: Float32Array;
  constructor(readonly width: number, readonly height: number) {
    this.acc = new Float32Array(width * height * 4);
  }

  fill(r: number, g: number, b: number, a = 1): void {
    for (let i = 0; i < this.acc.length; i += 4) {
      this.acc[i] = r * a;
      this.acc[i + 1] = g * a;
      this.acc[i + 2] = b * a;
      this.acc[i + 3] = a;
    }
  }

  /** Composite one source pixel (unpremultiplied colour, alpha) at index i. */
  private put(i: number, mode: BlendMode, sr: number, sg: number, sb: number, as: number): void {
    if (as <= 0) return;
    const A = this.acc;
    const ab = A[i + 3];
    if (mode === 'normal' || ab <= 0) {
      const k = 1 - as;
      A[i] = sr * as + A[i] * k;
      A[i + 1] = sg * as + A[i + 1] * k;
      A[i + 2] = sb * as + A[i + 2] * k;
      A[i + 3] = as + ab * k;
      return;
    }
    const cb: RGB = [A[i] / ab, A[i + 1] / ab, A[i + 2] / ab];
    const B = blendColour(mode, cb, [sr, sg, sb]);
    // co = αs(1-αb)Cs + αsαb B + (1-αs)αb Cb   (premultiplied)
    const k = 1 - as;
    A[i] = as * (1 - ab) * sr + as * ab * B[0] + k * A[i];
    A[i + 1] = as * (1 - ab) * sg + as * ab * B[1] + k * A[i + 1];
    A[i + 2] = as * (1 - ab) * sb + as * ab * B[2] + k * A[i + 2];
    A[i + 3] = as + ab * k;
  }

  /**
   * Draw a 16-bit image. `m` maps the image's pixel grid (0..w, 0..h) to output
   * pixels. Bilinear sampling on premultiplied values with transparent
   * outside, so edges are antialiased; big reductions are pre-filtered.
   * `coverage` (0..1 per output pixel) clips it, as a mask does.
   */
  drawImage16(img: Pixels16, m: Matrix, opacity: number, mode: BlendMode, coverage?: Float32Array | null): void {
    let src = img;
    let mm = m;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    if (sx < 0.5 || sy < 0.5) {
      const w = Math.max(1, Math.round(img.width * Math.min(1, sx * 1.5)));
      const h = Math.max(1, Math.round(img.height * Math.min(1, sy * 1.5)));
      src = resize16(img, w, h);
      const kx = img.width / w, ky = img.height / h;
      mm = [m[0] * kx, m[1] * kx, m[2] * ky, m[3] * ky, m[4], m[5]];
    }
    const det = mm[0] * mm[3] - mm[1] * mm[2];
    if (Math.abs(det) < 1e-12) return;
    // inverse affine: output -> source
    const ia = mm[3] / det, ib = -mm[1] / det, ic = -mm[2] / det, id = mm[0] / det;
    const ie = -(ia * mm[4] + ic * mm[5]), iff = -(ib * mm[4] + id * mm[5]);
    // output bounding box of the image
    const corners = [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]].map(([x, y]) => [mm[0] * x + mm[2] * y + mm[4], mm[1] * x + mm[3] * y + mm[5]]);
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1);
    const x1 = Math.min(this.width, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1);
    const y1 = Math.min(this.height, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
    const W = src.width, H = src.height, D = src.data;
    const inv = 1 / 65535;
    const tex = (x: number, y: number, out: number[]) => {
      if (x < 0 || y < 0 || x >= W || y >= H) { out[0] = out[1] = out[2] = out[3] = 0; return; }
      const o = (y * W + x) * 4;
      const a = D[o + 3] * inv;
      out[0] = D[o] * inv * a; out[1] = D[o + 1] * inv * a; out[2] = D[o + 2] * inv * a; out[3] = a;
    };
    const t00 = [0, 0, 0, 0], t10 = [0, 0, 0, 0], t01 = [0, 0, 0, 0], t11 = [0, 0, 0, 0];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ia * px + ic * py + ie - 0.5;
        const v = ib * px + id * py + iff - 0.5;
        if (u < -1 || v < -1 || u > W || v > H) continue;
        const fu = Math.floor(u), fv = Math.floor(v);
        const tu = u - fu, tv = v - fv;
        tex(fu, fv, t00); tex(fu + 1, fv, t10); tex(fu, fv + 1, t01); tex(fu + 1, fv + 1, t11);
        const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
        const a = t00[3] * w00 + t10[3] * w10 + t01[3] * w01 + t11[3] * w11;
        if (a <= 1e-7) continue;
        const r = (t00[0] * w00 + t10[0] * w10 + t01[0] * w01 + t11[0] * w11) / a;
        const g = (t00[1] * w00 + t10[1] * w10 + t01[1] * w01 + t11[1] * w11) / a;
        const b = (t00[2] * w00 + t10[2] * w10 + t01[2] * w01 + t11[2] * w11) / a;
        const i = y * this.width + x;
        const cov = coverage ? coverage[i] : 1;
        this.put(i * 4, mode, r, g, b, Math.min(1, a) * opacity * cov);
      }
    }
  }

  /** Blend an output-sized RGBA8 layer (unpremultiplied, as getImageData returns it). */
  drawRgba8(data: Uint8ClampedArray | Uint8Array, mode: BlendMode, coverage?: Float32Array | null): void {
    const inv = 1 / 255;
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3];
      if (!a) continue;
      this.put(i, mode, data[i] * inv, data[i + 1] * inv, data[i + 2] * inv, a * inv * (coverage ? coverage[p] : 1));
    }
  }

  /** Unpremultiplied 16-bit result. */
  toPixels16(): Pixels16 {
    const out = new Uint16Array(this.acc.length);
    const A = this.acc;
    for (let i = 0; i < A.length; i += 4) {
      const a = A[i + 3];
      if (a <= 0) continue;
      const k = 65535 / a;
      out[i] = Math.max(0, Math.min(65535, Math.round(A[i] * k)));
      out[i + 1] = Math.max(0, Math.min(65535, Math.round(A[i + 1] * k)));
      out[i + 2] = Math.max(0, Math.min(65535, Math.round(A[i + 2] * k)));
      out[i + 3] = Math.max(0, Math.min(65535, Math.round(a * 65535)));
    }
    return { width: this.width, height: this.height, data: out };
  }
}
