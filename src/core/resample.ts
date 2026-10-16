/**
 * Image resampling for Resize document / Image size and Canvas size.
 * Separable filters in premultiplied alpha (no dark fringes on cut-outs), with
 * the kernel widened when shrinking so downscales are properly averaged.
 */
import { createPixels, type Pixels } from './pixels';

export type ResampleMethod = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3';

export const RESAMPLE_METHODS: { value: ResampleMethod; label: string; hint: string }[] = [
  { value: 'nearest', label: 'Nearest neighbour', hint: 'Hard pixels, for pixel art and screenshots' },
  { value: 'bilinear', label: 'Bilinear', hint: 'Smooth and fast' },
  { value: 'bicubic', label: 'Bicubic', hint: 'Smooth gradients (best for enlarging)' },
  { value: 'lanczos3', label: 'Lanczos', hint: 'Sharpest detail (best for reducing)' },
];

function sinc(x: number): number {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

const KERNELS: Record<Exclude<ResampleMethod, 'nearest'>, { support: number; fn: (x: number) => number }> = {
  bilinear: { support: 1, fn: (x) => Math.max(0, 1 - Math.abs(x)) },
  bicubic: {
    support: 2,
    fn: (x) => {
      // Catmull-Rom (a = -0.5)
      const a = -0.5;
      const t = Math.abs(x);
      if (t <= 1) return (a + 2) * t ** 3 - (a + 3) * t ** 2 + 1;
      if (t < 2) return a * t ** 3 - 5 * a * t ** 2 + 8 * a * t - 4 * a;
      return 0;
    },
  },
  lanczos3: { support: 3, fn: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) },
};

interface Weights {
  start: Int32Array;
  count: Int32Array;
  w: Float32Array;
  stride: number;
}

function weights(srcLen: number, dstLen: number, method: Exclude<ResampleMethod, 'nearest'>): Weights {
  const k = KERNELS[method];
  const scale = dstLen / srcLen;
  const fscale = scale < 1 ? 1 / scale : 1;
  const support = k.support * fscale;
  const stride = Math.ceil(support * 2) + 2;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const w = new Float32Array(dstLen * stride);
  for (let i = 0; i < dstLen; i++) {
    const centre = (i + 0.5) / scale - 0.5;
    const lo = Math.max(0, Math.floor(centre - support));
    const hi = Math.min(srcLen - 1, Math.ceil(centre + support));
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi && n < stride; j++, n++) {
      const v = k.fn((j - centre) / fscale);
      w[i * stride + n] = v;
      sum += v;
    }
    if (sum !== 0) for (let q = 0; q < n; q++) w[i * stride + q] /= sum;
    start[i] = lo;
    count[i] = n;
  }
  return { start, count, w, stride };
}

/** Resize RGBA pixels to dw x dh. */
export function resample(src: Pixels, dw: number, dh: number, method: ResampleMethod = 'bicubic'): Pixels {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const { width: sw, height: sh, data: s } = src;
  if (method === 'nearest') {
    const out = createPixels(dw, dh);
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
        const i = (sy * sw + sx) * 4;
        out.data.set(s.subarray(i, i + 4), (y * dw + x) * 4);
      }
    }
    return out;
  }
  // premultiply into float
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3] / 255;
    pre[i] = s[i] * a;
    pre[i + 1] = s[i + 1] * a;
    pre[i + 2] = s[i + 2] * a;
    pre[i + 3] = s[i + 3];
  }
  // horizontal
  const wx = weights(sw, dw, method);
  const mid = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const st = wx.start[x];
      for (let k = 0; k < wx.count[x]; k++) {
        const wt = wx.w[x * wx.stride + k];
        const i = (y * sw + st + k) * 4;
        r += pre[i] * wt; g += pre[i + 1] * wt; b += pre[i + 2] * wt; a += pre[i + 3] * wt;
      }
      const o = (y * dw + x) * 4;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
    }
  }
  // vertical
  const wy = weights(sh, dh, method);
  const out = createPixels(dw, dh);
  const d = out.data;
  for (let y = 0; y < dh; y++) {
    const st = wy.start[y];
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < wy.count[y]; k++) {
        const wt = wy.w[y * wy.stride + k];
        const i = ((st + k) * dw + x) * 4;
        r += mid[i] * wt; g += mid[i + 1] * wt; b += mid[i + 2] * wt; a += mid[i + 3] * wt;
      }
      const o = (y * dw + x) * 4;
      const al = Math.max(0, Math.min(255, a));
      const inv = al > 0 ? 255 / al : 0;
      d[o] = r * inv; d[o + 1] = g * inv; d[o + 2] = b * inv; d[o + 3] = al;
    }
  }
  return out;
}

export type Anchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
export const ANCHORS: Anchor[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];

/** Offset of the old canvas inside the new one for a canvas-size change with an anchor. */
export function anchorOffset(oldW: number, oldH: number, newW: number, newH: number, a: Anchor): { dx: number; dy: number } {
  const fx = a.includes('l') ? 0 : a.includes('r') ? 1 : 0.5;
  const fy = a.startsWith('t') ? 0 : a.startsWith('b') ? 1 : 0.5;
  return { dx: Math.round((newW - oldW) * fx), dy: Math.round((newH - oldH) * fy) };
}

/**
 * Largest axis-aligned rectangle with the image's aspect ratio that fits inside
 * a w x h image rotated by `deg` (for Straighten's automatic crop).
 */
export function straightenCrop(w: number, h: number, deg: number): { w: number; h: number } {
  const a = Math.abs(((deg % 180) + 180) % 180);
  const t = ((a > 90 ? 180 - a : a) * Math.PI) / 180;
  if (t === 0) return { w, h };
  const c = Math.cos(t);
  const s = Math.sin(t);
  // scale k so the k*w x k*h rectangle (same centre) fits inside the rotated image
  const k = Math.min(w / (w * c + h * s), h / (w * s + h * c));
  return { w: w * k, h: h * k };
}
