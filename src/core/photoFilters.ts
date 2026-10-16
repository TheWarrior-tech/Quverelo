/**
 * Photo parity adjustments and filters (Colour balance, Gradient map, Motion
 * blur, Reduce noise). Pure RGBA buffer operations, like core/pixels.ts.
 */
import type { GradientStop } from './types';
import { clonePixels, createPixels, hslToRgb, luminance, rgbToHsl, type Pixels } from './pixels';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Tonal-range weights used by Colour balance (GIMP's transfer curves). */
export function toneWeights(l: number): { shadows: number; midtones: number; highlights: number } {
  const a = 0.25;
  const b = 0.333;
  const scale = 0.7;
  return {
    shadows: clamp01((l - b) / -a + 0.5) * scale,
    midtones: clamp01((l - b) / a + 0.5) * clamp01((l + b - 1) / -a + 0.5) * scale,
    highlights: clamp01((l + b - 1) / a + 0.5) * scale,
  };
}

export interface ColorBalanceParams {
  /** cyan (-100) .. red (+100), magenta .. green, yellow .. blue, per tonal range */
  shadowsCR: number; shadowsMG: number; shadowsYB: number;
  midtonesCR: number; midtonesMG: number; midtonesYB: number;
  highlightsCR: number; highlightsMG: number; highlightsYB: number;
  /** 1 keeps each pixel's lightness (Photoshop "Preserve luminosity") */
  preserveLuminosity: number;
}

export function colorBalance(src: Pixels, p: ColorBalanceParams): Pixels {
  // 256-entry transfer per channel, as GIMP / Photoshop do (depends on the channel value itself)
  const lut = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  const shifts = [
    [p.shadowsCR, p.midtonesCR, p.highlightsCR],
    [p.shadowsMG, p.midtonesMG, p.highlightsMG],
    [p.shadowsYB, p.midtonesYB, p.highlightsYB],
  ];
  for (let v = 0; v < 256; v++) {
    const w = toneWeights(v / 255);
    for (let c = 0; c < 3; c++) {
      const [s, m, h] = shifts[c];
      lut[c][v] = clamp01(v / 255 + (s / 100) * w.shadows + (m / 100) * w.midtones + (h / 100) * w.highlights);
    }
  }
  const out = clonePixels(src);
  const d = out.data;
  const keep = p.preserveLuminosity >= 0.5;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[0][d[i]], g = lut[1][d[i + 1]], b = lut[2][d[i + 2]];
    if (keep) {
      const [h, s] = rgbToHsl(r * 255, g * 255, b * 255);
      const [, , l0] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      [r, g, b] = hslToRgb(h, s, l0).map((x) => x / 255) as [number, number, number];
    }
    d[i] = r * 255;
    d[i + 1] = g * 255;
    d[i + 2] = b * 255;
  }
  return out;
}

export const DEFAULT_GRADIENT_MAP: GradientStop[] = [
  { offset: 0, color: '#000000' },
  { offset: 1, color: '#ffffff' },
];

export function hexRgb(c: string): [number, number, number] {
  const m = c.trim().match(/^#?([0-9a-f]{6})/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = c.match(/rgba?\(([^)]+)\)/i);
  if (r) {
    const p = r[1].split(',').map((x) => parseFloat(x));
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  }
  return [0, 0, 0];
}

/** 256 x RGB lookup along a gradient (stops sorted by offset). */
export function gradientLut(stops: GradientStop[]): Uint8ClampedArray {
  const s = [...(stops.length ? stops : DEFAULT_GRADIENT_MAP)].sort((a, b) => a.offset - b.offset).map((x) => ({ o: clamp01(x.offset), c: hexRgb(x.color) }));
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let c: [number, number, number];
    if (t <= s[0].o) c = s[0].c;
    else if (t >= s[s.length - 1].o) c = s[s.length - 1].c;
    else {
      let k = 0;
      while (k < s.length - 2 && t > s[k + 1].o) k++;
      const a = s[k], b = s[k + 1];
      const f = b.o > a.o ? (t - a.o) / (b.o - a.o) : 0;
      c = [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f];
    }
    lut[i * 3] = c[0];
    lut[i * 3 + 1] = c[1];
    lut[i * 3 + 2] = c[2];
  }
  return lut;
}

/** Gradient map: each pixel's luminance picks a colour on the gradient. */
export function gradientMap(src: Pixels, stops: GradientStop[], reverse = false): Pixels {
  const lut = gradientLut(stops);
  const out = clonePixels(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    let l = Math.round(luminance(d[i], d[i + 1], d[i + 2]));
    if (reverse) l = 255 - l;
    d[i] = lut[l * 3];
    d[i + 1] = lut[l * 3 + 1];
    d[i + 2] = lut[l * 3 + 2];
  }
  return out;
}

/**
 * Motion blur: average of samples along a line through each pixel
 * (angle in degrees, distance in px = total streak length). Premultiplied.
 */
export function motionBlur(src: Pixels, angle: number, distance: number): Pixels {
  const { width: w, height: h, data: s } = src;
  const n = Math.max(1, Math.round(distance));
  if (n <= 1) return clonePixels(src);
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a); // positive angle = counter-clockwise on screen, like Photoshop
  const out = createPixels(w, h);
  const o = out.data;
  const offs: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = k - (n - 1) / 2;
    offs.push(Math.round(t * dx), Math.round(t * dy));
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let k = 0; k < n; k++) {
        let sx = x + offs[k * 2];
        let sy = y + offs[k * 2 + 1];
        sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
        sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
        const i = (sy * w + sx) * 4;
        const A = s[i + 3];
        r += s[i] * A;
        g += s[i + 1] * A;
        b += s[i + 2] * A;
        al += A;
      }
      const i = (y * w + x) * 4;
      if (al > 0) {
        o[i] = r / al;
        o[i + 1] = g / al;
        o[i + 2] = b / al;
      }
      o[i + 3] = al / n;
    }
  }
  return out;
}

/**
 * Reduce noise: edge-preserving (bilateral) smoothing. `strength` 0..100 sets
 * how different a neighbour may be and still be averaged in; `radius` 1..4.
 * `detail` 0..100 blends a little of the original back to keep texture.
 */
export function reduceNoise(src: Pixels, strength: number, radius = 2, detail = 0): Pixels {
  const { width: w, height: h, data: s } = src;
  const r = Math.max(1, Math.min(4, Math.round(radius)));
  const sigmaR = 4 + (strength / 100) * 60; // colour-distance sigma (0..255 scale)
  const inv2r = 1 / (2 * sigmaR * sigmaR);
  const sigmaS = r / 1.5 + 0.5;
  const spatial: number[] = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) spatial.push(Math.exp(-(i * i + j * j) / (2 * sigmaS * sigmaS)));
  const rangeLut = new Float32Array(3 * 255 * 255 + 1);
  for (let k = 0; k < rangeLut.length; k++) rangeLut[k] = Math.exp(-k * inv2r / 3);
  const keep = Math.max(0, Math.min(1, detail / 100));
  const out = clonePixels(src);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (y * w + x) * 4;
      const cr = s[c], cg = s[c + 1], cb = s[c + 2];
      let wr = 0, ar = 0, ag = 0, ab = 0;
      let si = 0;
      for (let j = -r; j <= r; j++) {
        const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
        for (let i = -r; i <= r; i++, si++) {
          const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
          const q = (yy * w + xx) * 4;
          const dr = s[q] - cr, dg = s[q + 1] - cg, db = s[q + 2] - cb;
          const wt = spatial[si] * rangeLut[dr * dr + dg * dg + db * db];
          wr += wt;
          ar += s[q] * wt;
          ag += s[q + 1] * wt;
          ab += s[q + 2] * wt;
        }
      }
      o[c] = (ar / wr) * (1 - keep) + cr * keep;
      o[c + 1] = (ag / wr) * (1 - keep) + cg * keep;
      o[c + 2] = (ab / wr) * (1 - keep) + cb * keep;
    }
  }
  return out;
}

/** Standard deviation of luminance, a simple noise measure used by tests and the histogram panel. */
export function lumaStdDev(src: Pixels): number {
  const d = src.data;
  let n = 0, sum = 0, sq = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const l = luminance(d[i], d[i + 1], d[i + 2]);
    sum += l;
    sq += l * l;
    n++;
  }
  if (!n) return 0;
  const m = sum / n;
  return Math.sqrt(Math.max(0, sq / n - m * m));
}
