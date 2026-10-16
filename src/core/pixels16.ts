/**
 * 16 bits per channel pixel pipeline (Photo documents with Bit depth 16).
 *
 * Kept beside core/pixels.ts rather than inside it: the 8-bit functions there
 * stay exactly as they are, and every adjustment gets a 16-bit counterpart
 * here with the same formula and the same parameters (still given in 0..255
 * units, as the Adjustments panel shows them). Values are carried as
 * Uint16 0..65535 and every step is computed in floating point, so a stack of
 * strong adjustments does not band the way an 8-bit stack does.
 *
 * Pure and DOM-free (unit-tested in tests/unit/pixels16.test.ts).
 */
import type { Adjustment, GradientStop } from './types';
import { ADJUSTMENTS, applyAdjustment, defaultParams, luminance, mulberry32, rgbToHsl, hslToRgb, type Pixels } from './pixels';
import { curvesOf, monotoneCurve } from './curves';
import { DEFAULT_GRADIENT_MAP, hexRgb, toneWeights, type ColorBalanceParams } from './photoFilters';

export interface Pixels16 {
  width: number;
  height: number;
  /** RGBA, 0..65535, not premultiplied */
  data: Uint16Array;
}

const MAX = 65535;
/** 8-bit level to 16-bit level: 255 -> 65535 exactly */
const K = 257;
const clamp16 = (v: number) => (v < 0 ? 0 : v > MAX ? MAX : Math.round(v));

export function createPixels16(width: number, height: number, fill?: [number, number, number, number]): Pixels16 {
  const data = new Uint16Array(width * height * 4);
  if (fill) for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

export function clonePixels16(p: Pixels16): Pixels16 {
  return { width: p.width, height: p.height, data: new Uint16Array(p.data) };
}

/** Widen 8-bit pixels to 16-bit (v * 257, so 255 maps to 65535). */
export function to16(p: Pixels): Pixels16 {
  const out = new Uint16Array(p.data.length);
  for (let i = 0; i < out.length; i++) out[i] = p.data[i] * K;
  return { width: p.width, height: p.height, data: out };
}

/** Round 16-bit pixels to 8-bit (for the screen and 8-bit formats). */
export function to8(p: Pixels16): Pixels {
  const out = new Uint8ClampedArray(p.data.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(p.data[i] / K);
  return { width: p.width, height: p.height, data: out };
}

/** Number of distinct values in one channel: a 16-bit gradient keeps far more than 256. */
export function distinctLevels(p: Pixels16, channel = 0): number {
  const seen = new Uint8Array(65536);
  let n = 0;
  for (let i = channel; i < p.data.length; i += 4) if (!seen[p.data[i]]) { seen[p.data[i]] = 1; n++; }
  return n;
}

/** Build a full 65536-entry LUT from a function in 8-bit units (float in, float out). */
function lut16(fn: (v255: number) => number): Uint16Array {
  const lut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) lut[i] = clamp16(fn(i / K) * K);
  return lut;
}

function applyLut16(src: Pixels16, r: Uint16Array, g = r, b = r): Pixels16 {
  const out = clonePixels16(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
  return out;
}

/** Per-pixel op in 8-bit float units; the function writes 0..255 floats to out. */
function mapRGB16(src: Pixels16, fn: (r: number, g: number, b: number, out: number[], i: number) => void): Pixels16 {
  const out = clonePixels16(src);
  const d = out.data;
  const tmp = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i] / K, d[i + 1] / K, d[i + 2] / K, tmp, i);
    d[i] = clamp16(tmp[0] * K);
    d[i + 1] = clamp16(tmp[1] * K);
    d[i + 2] = clamp16(tmp[2] * K);
  }
  return out;
}

export function brightnessContrast16(src: Pixels16, brightness: number, contrast: number): Pixels16 {
  const b = (brightness / 100) * 255 * 0.5;
  const c = Math.max(-99.9, Math.min(100, contrast));
  const f = c >= 0 ? 1 + (c / 100) * 2 : 1 + c / 100;
  return applyLut16(src, lut16((v) => (v - 128) * f + 128 + b));
}

export function levels16(src: Pixels16, inBlack: number, inWhite: number, gamma: number, outBlack = 0, outWhite = 255): Pixels16 {
  const range = Math.max(1, inWhite - inBlack);
  const g = Math.max(0.01, gamma);
  return applyLut16(src, lut16((v) => {
    const n = Math.max(0, Math.min(1, (v - inBlack) / range));
    return outBlack + Math.pow(n, 1 / g) * (outWhite - outBlack);
  }));
}

export function applyCurves16(src: Pixels16, a: { curves?: Adjustment['curves']; params: Record<string, number> }): Pixels16 {
  const data = curvesOf(a);
  const master = monotoneCurve(data.rgb);
  const ch = (pts: typeof data.r) => {
    const own = monotoneCurve(pts);
    return lut16((v) => master(Math.max(0, Math.min(255, own(v)))));
  };
  return applyLut16(src, ch(data.r), ch(data.g), ch(data.b));
}

export function hueSaturation16(src: Pixels16, hue: number, saturation: number, lightness: number): Pixels16 {
  const hs = hue / 360;
  const sf = 1 + saturation / 100;
  const lf = lightness / 100;
  return mapRGB16(src, (r, g, b, out) => {
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

export function exposure16(src: Pixels16, stops: number, offset = 0, gamma = 1): Pixels16 {
  const f = Math.pow(2, stops);
  const g = Math.max(0.01, gamma);
  return applyLut16(src, lut16((v) => Math.pow(Math.max(0, (v / 255) * f + offset), 1 / g) * 255));
}

export function blackWhite16(src: Pixels16, strength = 100): Pixels16 {
  const t = strength / 100;
  return mapRGB16(src, (r, g, b, out) => {
    const y = luminance(r, g, b);
    out[0] = r + (y - r) * t;
    out[1] = g + (y - g) * t;
    out[2] = b + (y - b) * t;
  });
}

export function invert16(src: Pixels16): Pixels16 {
  const lut = new Uint16Array(65536);
  for (let i = 0; i < 65536; i++) lut[i] = MAX - i;
  return applyLut16(src, lut);
}

export function posterize16(src: Pixels16, levelsCount: number): Pixels16 {
  const n = Math.max(2, Math.round(levelsCount));
  const step = 255 / (n - 1);
  return applyLut16(src, lut16((v) => Math.round(v / step) * step));
}

export function threshold16(src: Pixels16, level: number): Pixels16 {
  return mapRGB16(src, (r, g, b, out) => {
    const v = luminance(r, g, b) >= level ? 255 : 0;
    out[0] = out[1] = out[2] = v;
  });
}

export function vibrance16(src: Pixels16, amount: number): Pixels16 {
  const a = amount / 100;
  return mapRGB16(src, (r, g, b, out) => {
    const max = Math.max(r, g, b);
    const avg = (r + g + b) / 3;
    const sat = (Math.abs(max - avg) * 2) / 255;
    const k = a * (1 - sat) * 1.5;
    out[0] = r + (r - avg) * k;
    out[1] = g + (g - avg) * k;
    out[2] = b + (b - avg) * k;
  });
}

export function temperature16(src: Pixels16, temp: number, tint = 0): Pixels16 {
  const t = temp / 100;
  const ti = tint / 100;
  return mapRGB16(src, (r, g, b, out) => {
    out[0] = r + 40 * t;
    out[1] = g + 30 * ti;
    out[2] = b - 40 * t;
  });
}

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
      for (let k = -r; k <= r; k++) acc += src[base + Math.min(len - 1, Math.max(0, k)) * stride + c];
      for (let i = 0; i < len; i++) {
        dst[base + i * stride + c] = acc * inv;
        acc += src[base + Math.min(len - 1, i + r + 1) * stride + c] - src[base + Math.max(0, i - r) * stride + c];
      }
    }
  }
}

/** Same three-box approximation as the 8-bit blur, accumulated in float on premultiplied 16-bit values. */
export function gaussianBlur16(src: Pixels16, radius: number): Pixels16 {
  const r = Math.max(0, radius);
  if (r < 0.5) return clonePixels16(src);
  const { width: w, height: h } = src;
  const a = new Float32Array(src.data.length);
  const b = new Float32Array(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const al = src.data[i + 3] / MAX;
    a[i] = src.data[i] * al;
    a[i + 1] = src.data[i + 1] * al;
    a[i + 2] = src.data[i + 2] * al;
    a[i + 3] = src.data[i + 3];
  }
  const sigma = r / 2;
  const box = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  for (let pass = 0; pass < 3; pass++) {
    boxBlurPass(a, b, w, h, box, true);
    boxBlurPass(b, a, w, h, box, false);
  }
  const out = createPixels16(w, h);
  for (let i = 0; i < a.length; i += 4) {
    const al = a[i + 3];
    const k = al > 0 ? MAX / al : 0;
    out.data[i] = clamp16(a[i] * k);
    out.data[i + 1] = clamp16(a[i + 1] * k);
    out.data[i + 2] = clamp16(a[i + 2] * k);
    out.data[i + 3] = clamp16(al);
  }
  return out;
}

export function unsharpMask16(src: Pixels16, amount: number, radius: number): Pixels16 {
  const blurred = gaussianBlur16(src, radius);
  const k = amount / 100;
  const out = clonePixels16(src);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = clamp16(src.data[i + c] + (src.data[i + c] - blurred.data[i + c]) * k);
  }
  return out;
}

export function addNoise16(src: Pixels16, amount: number, mono = true, seed = 1): Pixels16 {
  const rnd = mulberry32(seed);
  const s = (amount / 100) * 128 * K;
  const out = clonePixels16(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = (rnd() - 0.5) * 2 * s;
      d[i] = clamp16(d[i] + n);
      d[i + 1] = clamp16(d[i + 1] + n);
      d[i + 2] = clamp16(d[i + 2] + n);
    } else {
      d[i] = clamp16(d[i] + (rnd() - 0.5) * 2 * s);
      d[i + 1] = clamp16(d[i + 1] + (rnd() - 0.5) * 2 * s);
      d[i + 2] = clamp16(d[i + 2] + (rnd() - 0.5) * 2 * s);
    }
  }
  return out;
}

export function vignette16(src: Pixels16, amount: number, size = 50): Pixels16 {
  const { width: w, height: h } = src;
  const out = clonePixels16(src);
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
      d[i] = clamp16(d[i] * f);
      d[i + 1] = clamp16(d[i + 1] * f);
      d[i + 2] = clamp16(d[i + 2] * f);
    }
  }
  return out;
}

/** Colour balance at 16 bits: the same GIMP transfer as photoFilters.colorBalance, evaluated per value in float. */
export function colorBalance16(src: Pixels16, p: ColorBalanceParams): Pixels16 {
  const shifts = [
    [p.shadowsCR, p.midtonesCR, p.highlightsCR],
    [p.shadowsMG, p.midtonesMG, p.highlightsMG],
    [p.shadowsYB, p.midtonesYB, p.highlightsYB],
  ];
  const luts = shifts.map(([s, m, h]) => lut16((v) => {
    const w = toneWeights(v / 255);
    return v + ((s / 100) * w.shadows + (m / 100) * w.midtones + (h / 100) * w.highlights) * 255;
  }));
  const keep = p.preserveLuminosity >= 0.5;
  if (!keep) return applyLut16(src, luts[0], luts[1], luts[2]);
  const [lr, lg, lb] = luts;
  return mapRGB16(src, (r, g, b, out, i) => {
    const d = src.data;
    const [h, s] = rgbToHsl(lr[d[i]] / K, lg[d[i + 1]] / K, lb[d[i + 2]] / K);
    const [, , l0] = rgbToHsl(r, g, b);
    const c = hslToRgb(h, s, l0);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
}

/** Gradient map at 16 bits: luminance picks a colour on the ramp, interpolated in float (no 256-step LUT). */
export function gradientMap16(src: Pixels16, stops: GradientStop[], reverse = false): Pixels16 {
  const s = [...(stops.length ? stops : DEFAULT_GRADIENT_MAP)].sort((a, b) => a.offset - b.offset)
    .map((x) => ({ o: Math.min(1, Math.max(0, x.offset)), c: hexRgb(x.color) }));
  const at = (t: number): [number, number, number] => {
    if (t <= s[0].o) return s[0].c;
    if (t >= s[s.length - 1].o) return s[s.length - 1].c;
    let k = 0;
    while (k < s.length - 2 && t > s[k + 1].o) k++;
    const a = s[k], b = s[k + 1];
    const f = b.o > a.o ? (t - a.o) / (b.o - a.o) : 0;
    return [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f];
  };
  return mapRGB16(src, (r, g, b, out) => {
    let t = Math.min(1, Math.max(0, luminance(r, g, b) / 255));
    if (reverse) t = 1 - t;
    const c = at(t);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
}

/** Motion blur at 16 bits (photoFilters.motionBlur with Uint16 accumulation). */
export function motionBlur16(src: Pixels16, angle: number, distance: number): Pixels16 {
  const { width: w, height: h, data: s } = src;
  const n = Math.max(1, Math.round(distance));
  if (n <= 1) return clonePixels16(src);
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const out = createPixels16(w, h);
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
        o[i] = clamp16(r / al);
        o[i + 1] = clamp16(g / al);
        o[i + 2] = clamp16(b / al);
      }
      o[i + 3] = clamp16(al / n);
    }
  }
  return out;
}

/** Edge-preserving (bilateral) noise reduction at 16 bits; same weights as photoFilters.reduceNoise, distances in float 0..255 units. */
export function reduceNoise16(src: Pixels16, strength: number, radius = 2, detail = 0): Pixels16 {
  const { width: w, height: h, data: s } = src;
  const r = Math.max(1, Math.min(4, Math.round(radius)));
  const sigmaR = 4 + (strength / 100) * 60;
  const inv = 1 / (2 * sigmaR * sigmaR * 3 * K * K);
  const sigmaS = r / 1.5 + 0.5;
  const spatial: number[] = [];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) spatial.push(Math.exp(-(i * i + j * j) / (2 * sigmaS * sigmaS)));
  const keep = Math.max(0, Math.min(1, detail / 100));
  const out = clonePixels16(src);
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
          const wt = spatial[si] * Math.exp(-(dr * dr + dg * dg + db * db) * inv);
          wr += wt;
          ar += s[q] * wt;
          ag += s[q + 1] * wt;
          ab += s[q + 2] * wt;
        }
      }
      o[c] = clamp16((ar / wr) * (1 - keep) + cr * keep);
      o[c + 1] = clamp16((ag / wr) * (1 - keep) + cg * keep);
      o[c + 2] = clamp16((ab / wr) * (1 - keep) + cb * keep);
    }
  }
  return out;
}

/**
 * One adjustment at 16 bits. Any adjustment type without a 16-bit
 * counterpart here (one added later to core/pixels.ts) still works: it runs at
 * 8 bits and its result is widened, so the stack never breaks.
 */
export function applyAdjustment16(src: Pixels16, a: Pick<Adjustment, 'type' | 'params' | 'curves' | 'stops'>, scale = 1): Pixels16 {
  const known = ADJUSTMENTS.some((s) => s.type === a.type);
  const p = { ...(known ? defaultParams(a.type) : {}), ...a.params };
  switch (a.type) {
    case 'brightness-contrast': return brightnessContrast16(src, p.brightness, p.contrast);
    case 'levels': return levels16(src, p.inBlack, p.inWhite, p.gamma, p.outBlack, p.outWhite);
    case 'curves': return applyCurves16(src, { curves: a.curves, params: a.params });
    case 'hue-saturation': return hueSaturation16(src, p.hue, p.saturation, p.lightness);
    case 'exposure': return exposure16(src, p.exposure, p.offset, p.gamma);
    case 'black-white': return blackWhite16(src, p.strength);
    case 'invert': return invert16(src);
    case 'posterize': return posterize16(src, p.levels);
    case 'threshold': return threshold16(src, p.level);
    case 'vibrance': return vibrance16(src, p.amount);
    case 'temperature': return temperature16(src, p.temperature, p.tint);
    case 'blur': return gaussianBlur16(src, p.radius * scale);
    case 'sharpen': return unsharpMask16(src, p.amount, Math.max(0.5, p.radius * scale));
    case 'noise': return addNoise16(src, p.amount, p.mono >= 0.5, p.seed);
    case 'vignette': return vignette16(src, p.amount, p.size);
    case 'color-balance': return colorBalance16(src, p as unknown as ColorBalanceParams);
    case 'gradient-map': return gradientMap16(src, a.stops ?? DEFAULT_GRADIENT_MAP, p.reverse >= 0.5);
    case 'motion-blur': return motionBlur16(src, p.angle, p.distance * scale);
    case 'reduce-noise': return reduceNoise16(src, p.strength, Math.max(1, Math.round(p.radius * scale)), p.detail);
    default: return known ? to16(applyAdjustment(to8(src), a, scale)) : src;
  }
}

/** True when every type in the stack has a native 16-bit path. */
export function stackIs16Bit(list: Pick<Adjustment, 'type' | 'enabled'>[]): boolean {
  const native = new Set(['brightness-contrast', 'levels', 'curves', 'hue-saturation', 'exposure', 'black-white', 'invert', 'posterize', 'threshold', 'vibrance', 'temperature', 'blur', 'sharpen', 'noise', 'vignette', 'color-balance', 'gradient-map', 'motion-blur', 'reduce-noise']);
  return list.every((a) => !a.enabled || native.has(a.type));
}

export function applyAdjustments16(src: Pixels16, list: Adjustment[], scale = 1): Pixels16 {
  let cur = src;
  for (const a of list) if (a.enabled) cur = applyAdjustment16(cur, a, scale);
  return cur;
}

/** Bilinear downscale (for the on-screen preview of big 16-bit photos). */
export function resize16(src: Pixels16, w: number, h: number): Pixels16 {
  const out = createPixels16(w, h);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(src.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(src.width - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * src.width + x0) * 4, b = (y0 * src.width + x1) * 4, c = (y1 * src.width + x0) * 4, d = (y1 * src.width + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = src.data[a + k] + (src.data[b + k] - src.data[a + k]) * tx;
        const bot = src.data[c + k] + (src.data[d + k] - src.data[c + k]) * tx;
        out.data[o + k] = clamp16(top + (bot - top) * ty);
      }
    }
  }
  return out;
}

/**
 * Keep 16-bit precision through an 8-bit pixel edit (brush, eraser, fill…):
 * wherever the edited 8-bit pixel still equals the rounded original, the
 * original 16-bit value is kept; edited pixels take the new 8-bit value.
 * Returns null when the sizes differ (crop, resize), where nothing maps.
 */
export function merge16(original: Pixels16, edited: Pixels): Pixels16 | null {
  if (original.width !== edited.width || original.height !== edited.height) return null;
  const out = new Uint16Array(original.data.length);
  const o = original.data;
  const e = edited.data;
  for (let i = 0; i < out.length; i++) {
    const q = Math.round(o[i] / K);
    out[i] = q === e[i] ? o[i] : e[i] * K;
  }
  return { width: original.width, height: original.height, data: out };
}
