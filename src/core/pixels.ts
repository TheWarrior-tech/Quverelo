/**
 * Pure pixel operations on RGBA buffers. No DOM required, so they run in
 * tests, in the renderer, and in workers alike.
 */
import type { Adjustment, AdjustmentType } from './types';

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createPixels(width: number, height: number, fill?: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

export function clonePixels(p: Pixels): Pixels {
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function mapRGB(src: Pixels, fn: (r: number, g: number, b: number, out: number[]) => void): Pixels {
  const out = clonePixels(src);
  const d = out.data;
  const tmp = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i], d[i + 1], d[i + 2], tmp);
    d[i] = tmp[0];
    d[i + 1] = tmp[1];
    d[i + 2] = tmp[2];
  }
  return out;
}

function applyLut(src: Pixels, lut: Uint8ClampedArray | number[], lutG = lut, lutB = lut): Pixels {
  const out = clonePixels(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lutG[d[i + 1]];
    d[i + 2] = lutB[d[i + 2]];
  }
  return out;
}

function buildLut(fn: (v: number) => number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp255(Math.round(fn(i)));
  return lut;
}

export function brightnessContrast(src: Pixels, brightness: number, contrast: number): Pixels {
  const b = (brightness / 100) * 255 * 0.5;
  const c = Math.max(-99.9, Math.min(100, contrast));
  const f = c >= 0 ? 1 + c / 100 * 2 : 1 + c / 100;
  return applyLut(src, buildLut((v) => (v - 128) * f + 128 + b));
}

export function levels(src: Pixels, inBlack: number, inWhite: number, gamma: number, outBlack = 0, outWhite = 255): Pixels {
  const range = Math.max(1, inWhite - inBlack);
  const g = Math.max(0.01, gamma);
  return applyLut(
    src,
    buildLut((v) => {
      const n = Math.max(0, Math.min(1, (v - inBlack) / range));
      return outBlack + Math.pow(n, 1 / g) * (outWhite - outBlack);
    }),
  );
}

/** Monotone cubic (Fritsch–Carlson) curve through points sorted by x. */
export function curveLut(points: { x: number; y: number }[]): Uint8ClampedArray {
  const p = [...points].sort((a, b) => a.x - b.x);
  const n = p.length;
  if (n < 2) return buildLut((v) => v);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1].x - p[i].x || 1e-6);
    slope.push((p[i + 1].y - p[i].y) / (dx[i]));
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  return buildLut((v) => {
    if (v <= p[0].x) return p[0].y;
    if (v >= p[n - 1].x) return p[n - 1].y;
    let i = 0;
    while (i < n - 2 && v > p[i + 1].x) i++;
    const h = dx[i];
    const t = (v - p[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1].y +
      (t3 - t2) * h * m[i + 1]
    );
  });
}

export function curves(src: Pixels, shadows: number, midtones: number, highlights: number): Pixels {
  return applyLut(
    src,
    curveLut([
      { x: 0, y: 0 },
      { x: 64, y: 64 + shadows * 0.64 },
      { x: 128, y: 128 + midtones * 0.64 },
      { x: 192, y: 192 + highlights * 0.64 },
      { x: 255, y: 255 },
    ]),
  );
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

export function hueSaturation(src: Pixels, hue: number, saturation: number, lightness: number): Pixels {
  const hs = hue / 360;
  const sf = 1 + saturation / 100;
  const lf = lightness / 100;
  return mapRGB(src, (r, g, b, out) => {
    let [h, s, l] = rgbToHsl(r, g, b);
    h = (h + hs + 1) % 1;
    s = Math.max(0, Math.min(1, s * sf));
    l = lf >= 0 ? l + (1 - l) * lf : l * (1 + lf);
    const [nr, ng, nb] = hslToRgb(h, s, l);
    out[0] = nr;
    out[1] = ng;
    out[2] = nb;
  });
}

export function exposure(src: Pixels, stops: number, offset = 0, gamma = 1): Pixels {
  const f = Math.pow(2, stops);
  const g = Math.max(0.01, gamma);
  return applyLut(
    src,
    buildLut((v) => {
      const n = Math.max(0, (v / 255) * f + offset);
      return Math.pow(n, 1 / g) * 255;
    }),
  );
}

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function blackWhite(src: Pixels, strength = 100): Pixels {
  const t = strength / 100;
  return mapRGB(src, (r, g, b, out) => {
    const y = luminance(r, g, b);
    out[0] = r + (y - r) * t;
    out[1] = g + (y - g) * t;
    out[2] = b + (y - b) * t;
  });
}

export function invertColors(src: Pixels): Pixels {
  return applyLut(src, buildLut((v) => 255 - v));
}

export function posterize(src: Pixels, levelsCount: number): Pixels {
  const n = Math.max(2, Math.round(levelsCount));
  const step = 255 / (n - 1);
  return applyLut(src, buildLut((v) => Math.round(v / step) * step));
}

export function threshold(src: Pixels, level: number): Pixels {
  return mapRGB(src, (r, g, b, out) => {
    const v = luminance(r, g, b) >= level ? 255 : 0;
    out[0] = out[1] = out[2] = v;
  });
}

export function vibrance(src: Pixels, amount: number): Pixels {
  const a = amount / 100;
  return mapRGB(src, (r, g, b, out) => {
    const max = Math.max(r, g, b);
    const avg = (r + g + b) / 3;
    const sat = (Math.abs(max - avg) * 2) / 255;
    const k = a * (1 - sat) * 1.5;
    out[0] = r + (r - avg) * k;
    out[1] = g + (g - avg) * k;
    out[2] = b + (b - avg) * k;
  });
}

export function temperature(src: Pixels, temp: number, tint = 0): Pixels {
  const t = temp / 100;
  const ti = tint / 100;
  return mapRGB(src, (r, g, b, out) => {
    out[0] = r + 40 * t;
    out[1] = g + 30 * ti;
    out[2] = b - 40 * t;
  });
}

/** Separable box blur on all four channels (premultiplied to avoid dark halos). */
function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 4 : w * 4;
  const lineStride = horizontal ? w * 4 : 4;
  const inv = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = line * lineStride;
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) {
        const idx = Math.min(len - 1, Math.max(0, k));
        acc += src[base + idx * stride + c];
      }
      for (let i = 0; i < len; i++) {
        dst[base + i * stride + c] = acc * inv;
        const addIdx = Math.min(len - 1, i + r + 1);
        const subIdx = Math.max(0, i - r);
        acc += src[base + addIdx * stride + c] - src[base + subIdx * stride + c];
      }
    }
  }
}

export function gaussianBlur(src: Pixels, radius: number): Pixels {
  const r = Math.max(0, radius);
  if (r < 0.5) return clonePixels(src);
  const { width: w, height: h } = src;
  const a = new Float32Array(src.data.length);
  const b = new Float32Array(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const al = src.data[i + 3] / 255;
    a[i] = src.data[i] * al;
    a[i + 1] = src.data[i + 1] * al;
    a[i + 2] = src.data[i + 2] * al;
    a[i + 3] = src.data[i + 3];
  }
  // three box passes approximate a gaussian with sigma ≈ radius / 2
  const sigma = r / 2;
  const box = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(a, b, w, h, box, true);
    boxBlurPass(b, a, w, h, box, false);
  }
  const out = createPixels(w, h);
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3];
    const k = al > 0 ? 255 / al : 0;
    out.data[i] = a[i] * k;
    out.data[i + 1] = a[i + 1] * k;
    out.data[i + 2] = a[i + 2] * k;
    out.data[i + 3] = al;
  }
  return out;
}

export function unsharpMask(src: Pixels, amount: number, radius: number): Pixels {
  const blurred = gaussianBlur(src, radius);
  const k = amount / 100;
  const out = clonePixels(src);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = src.data[i] + (src.data[i] - blurred.data[i]) * k;
    out.data[i + 1] = src.data[i + 1] + (src.data[i + 1] - blurred.data[i + 1]) * k;
    out.data[i + 2] = src.data[i + 2] + (src.data[i + 2] - blurred.data[i + 2]) * k;
  }
  return out;
}

/** Deterministic PRNG so noise previews are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function addNoise(src: Pixels, amount: number, mono = true, seed = 1): Pixels {
  const rnd = mulberry32(seed);
  const s = (amount / 100) * 128;
  const out = clonePixels(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = (rnd() - 0.5) * 2 * s;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    } else {
      d[i] += (rnd() - 0.5) * 2 * s;
      d[i + 1] += (rnd() - 0.5) * 2 * s;
      d[i + 2] += (rnd() - 0.5) * 2 * s;
    }
  }
  return out;
}

export function vignette(src: Pixels, amount: number, size = 50): Pixels {
  const { width: w, height: h } = src;
  const out = clonePixels(src);
  const d = out.data;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const inner = (size / 100) * 0.8;
  const strength = amount / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxR;
      const t = r <= inner ? 0 : Math.min(1, (r - inner) / (1 - inner));
      const f = 1 - strength * t * t;
      const i = (y * w + x) * 4;
      d[i] *= f;
      d[i + 1] *= f;
      d[i + 2] *= f;
    }
  }
  return out;
}

export interface AdjustmentSpec {
  type: AdjustmentType;
  label: string;
  params: { key: string; label: string; min: number; max: number; step: number; default: number }[];
}

export const ADJUSTMENTS: AdjustmentSpec[] = [
  { type: 'brightness-contrast', label: 'Brightness / Contrast', params: [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, default: 0 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, default: 0 },
  ] },
  { type: 'levels', label: 'Levels', params: [
    { key: 'inBlack', label: 'Black point', min: 0, max: 254, step: 1, default: 0 },
    { key: 'inWhite', label: 'White point', min: 1, max: 255, step: 1, default: 255 },
    { key: 'gamma', label: 'Gamma', min: 0.1, max: 5, step: 0.01, default: 1 },
    { key: 'outBlack', label: 'Output black', min: 0, max: 255, step: 1, default: 0 },
    { key: 'outWhite', label: 'Output white', min: 0, max: 255, step: 1, default: 255 },
  ] },
  { type: 'curves', label: 'Curves', params: [
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, default: 0 },
    { key: 'midtones', label: 'Midtones', min: -100, max: 100, step: 1, default: 0 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, default: 0 },
  ] },
  { type: 'hue-saturation', label: 'Hue / Saturation', params: [
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, default: 0 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, default: 0 },
    { key: 'lightness', label: 'Lightness', min: -100, max: 100, step: 1, default: 0 },
  ] },
  { type: 'exposure', label: 'Exposure', params: [
    { key: 'exposure', label: 'Exposure (stops)', min: -3, max: 3, step: 0.05, default: 0 },
    { key: 'offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01, default: 1 },
  ] },
  { type: 'vibrance', label: 'Vibrance', params: [
    { key: 'amount', label: 'Vibrance', min: -100, max: 100, step: 1, default: 25 },
  ] },
  { type: 'temperature', label: 'White Balance', params: [
    { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, default: 0 },
    { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, default: 0 },
  ] },
  { type: 'black-white', label: 'Black & White', params: [
    { key: 'strength', label: 'Strength', min: 0, max: 100, step: 1, default: 100 },
  ] },
  { type: 'invert', label: 'Invert', params: [] },
  { type: 'posterize', label: 'Posterize', params: [
    { key: 'levels', label: 'Levels', min: 2, max: 32, step: 1, default: 6 },
  ] },
  { type: 'threshold', label: 'Threshold', params: [
    { key: 'level', label: 'Level', min: 0, max: 255, step: 1, default: 128 },
  ] },
  { type: 'blur', label: 'Gaussian Blur', params: [
    { key: 'radius', label: 'Radius (px)', min: 0, max: 100, step: 0.5, default: 4 },
  ] },
  { type: 'sharpen', label: 'Unsharp Mask', params: [
    { key: 'amount', label: 'Amount (%)', min: 0, max: 300, step: 1, default: 80 },
    { key: 'radius', label: 'Radius (px)', min: 0.5, max: 10, step: 0.5, default: 1.5 },
  ] },
  { type: 'noise', label: 'Add Noise', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 10 },
    { key: 'mono', label: 'Monochromatic', min: 0, max: 1, step: 1, default: 1 },
    { key: 'seed', label: 'Seed', min: 1, max: 999, step: 1, default: 7 },
  ] },
  { type: 'vignette', label: 'Vignette', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, default: 50 },
    { key: 'size', label: 'Size', min: 0, max: 100, step: 1, default: 50 },
  ] },
];

export function adjustmentSpec(type: AdjustmentType): AdjustmentSpec {
  return ADJUSTMENTS.find((a) => a.type === type)!;
}

export function defaultParams(type: AdjustmentType): Record<string, number> {
  return Object.fromEntries(adjustmentSpec(type).params.map((p) => [p.key, p.default]));
}

export function applyAdjustment(src: Pixels, a: Pick<Adjustment, 'type' | 'params'>, scale = 1): Pixels {
  const p = { ...defaultParams(a.type), ...a.params };
  switch (a.type) {
    case 'brightness-contrast': return brightnessContrast(src, p.brightness, p.contrast);
    case 'levels': return levels(src, p.inBlack, p.inWhite, p.gamma, p.outBlack, p.outWhite);
    case 'curves': return curves(src, p.shadows, p.midtones, p.highlights);
    case 'hue-saturation': return hueSaturation(src, p.hue, p.saturation, p.lightness);
    case 'exposure': return exposure(src, p.exposure, p.offset, p.gamma);
    case 'black-white': return blackWhite(src, p.strength);
    case 'invert': return invertColors(src);
    case 'posterize': return posterize(src, p.levels);
    case 'threshold': return threshold(src, p.level);
    case 'vibrance': return vibrance(src, p.amount);
    case 'temperature': return temperature(src, p.temperature, p.tint);
    case 'blur': return gaussianBlur(src, p.radius * scale);
    case 'sharpen': return unsharpMask(src, p.amount, Math.max(0.5, p.radius * scale));
    case 'noise': return addNoise(src, p.amount, p.mono >= 0.5, p.seed);
    case 'vignette': return vignette(src, p.amount, p.size);
    default: return src;
  }
}

/** Apply an adjustment stack. `scale` shrinks spatial radii for downsampled previews. */
export function applyAdjustments(src: Pixels, list: Adjustment[], scale = 1): Pixels {
  let cur = src;
  for (const a of list) if (a.enabled) cur = applyAdjustment(cur, a, scale);
  return cur;
}

/** 256-bin luminance + RGB histogram. */
export function histogram(src: Pixels): { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array } {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    r[d[i]]++;
    g[d[i + 1]]++;
    b[d[i + 2]]++;
    l[Math.round(luminance(d[i], d[i + 1], d[i + 2]))]++;
  }
  return { r, g, b, l };
}

/** Flood fill (magic wand) mask from a seed point with tolerance 0..255. */
export function floodMask(src: Pixels, sx: number, sy: number, tolerance: number, contiguous = true): Uint8Array {
  const { width: w, height: h, data: d } = src;
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const i0 = (sy * w + sx) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
  const tol = tolerance * tolerance * 3;
  const match = (i: number) => {
    const dr = d[i] - tr, dg = d[i + 1] - tg, db = d[i + 2] - tb, da = d[i + 3] - ta;
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p * 4)) mask[p] = 1;
    return mask;
  }
  const stack = [sy * w + sx];
  while (stack.length) {
    const p = stack.pop()!;
    if (mask[p]) continue;
    if (!match(p * 4)) continue;
    mask[p] = 1;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return mask;
}
