/**
 * Pre/post-processing for the QuvSelect segmentation model (pure functions, no DOM, unit-tested).
 *
 * Model contract (see ml/MODEL_CARD.md):
 *   input  "input"  float32 [1, 6, S, S]: RGB normalised with ImageNet mean/std, +click map, -click map, previous mask
 *   output "logits" float32 [1, 1, S, S]
 * Images are squash-resized to S x S (no letterbox), exactly as in training.
 */
import { encodeClicks, type SelectionClick } from './clickMaps';

export const MODEL_SIZE = 320;
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA bytes, row-major (ImageData layout) */
  data: Uint8ClampedArray | Uint8Array;
}

export interface MaskImage {
  width: number;
  height: number;
  /** one byte per pixel: 0 = outside, 255 = inside (soft values allowed) */
  data: Uint8Array;
}

/** Per-output-pixel filter taps for one axis (PIL-style triangle filter; antialiased when shrinking). */
function taps(src: number, dst: number): { start: Int32Array; count: Int32Array; weights: Float32Array; k: number } {
  const scale = src / dst;
  const sc = Math.max(1, scale);
  const support = sc; // triangle filter radius 1, stretched when downscaling
  const k = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(dst);
  const count = new Int32Array(dst);
  const weights = new Float32Array(dst * k);
  for (let i = 0; i < dst; i++) {
    const centre = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(centre - support));
    const hi = Math.min(src, Math.ceil(centre + support));
    let sum = 0;
    let n = 0;
    for (let j = lo; j < hi && n < k; j++, n++) {
      const w = Math.max(0, 1 - Math.abs((j + 0.5 - centre) / sc));
      weights[i * k + n] = w;
      sum += w;
    }
    if (sum > 0) for (let q = 0; q < n; q++) weights[i * k + q] /= sum;
    start[i] = lo;
    count[i] = n;
  }
  return { start, count, weights, k };
}

/**
 * Resize one float plane with a separable bilinear (triangle) filter. Matches PIL's BILINEAR resample,
 * which the training data was built with: plain bilinear when enlarging, antialiased when shrinking.
 */
export function resizePlane(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const tx = taps(sw, dw);
  const ty = taps(sh, dh);
  const tmp = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      let v = 0;
      const s0 = tx.start[x];
      for (let q = 0; q < tx.count[x]; q++) v += src[row + s0 + q] * tx.weights[x * tx.k + q];
      tmp[y * dw + x] = v;
    }
  }
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const s0 = ty.start[y];
    for (let x = 0; x < dw; x++) {
      let v = 0;
      for (let q = 0; q < ty.count[y]; q++) v += tmp[(s0 + q) * dw + x] * ty.weights[y * ty.k + q];
      out[y * dw + x] = v;
    }
  }
  return out;
}

/**
 * Build the [1, 6, S, S] input tensor. Transparent pixels are composited on white
 * (the app's paper colour) before normalisation.
 */
export function buildInput(
  img: RgbaImage,
  clicks: SelectionClick[] = [],
  prevMask: MaskImage | null = null,
  size = MODEL_SIZE,
): Float32Array {
  const { width: W, height: H, data } = img;
  const n = size * size;
  const out = new Float32Array(6 * n);
  const planes = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const a = data[i + 3] / 255;
    for (let c = 0; c < 3; c++) planes[c][p] = (data[i + c] * a + 255 * (1 - a)) / 255;
  }
  for (let c = 0; c < 3; c++) {
    const r = resizePlane(planes[c], W, H, size, size);
    const m = MEAN[c];
    const s = STD[c];
    for (let k = 0; k < n; k++) out[c * n + k] = (r[k] - m) / s;
  }
  out.set(encodeClicks(size, size, clicks.filter((c) => c.positive), W, H), 3 * n);
  out.set(encodeClicks(size, size, clicks.filter((c) => !c.positive), W, H), 4 * n);
  if (prevMask) {
    const pm = new Float32Array(prevMask.width * prevMask.height);
    for (let k = 0; k < pm.length; k++) pm[k] = prevMask.data[k] >= 128 ? 1 : 0;
    out.set(resizePlane(pm, prevMask.width, prevMask.height, size, size).map((v) => (v >= 0.5 ? 1 : 0)), 5 * n);
  }
  return out;
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Logits at model resolution -> probability (0..1) at the source resolution.
 * The *logits* are upsampled bilinearly first and the sigmoid applied afterwards, so the 0.5
 * contour is the bilinear zero-crossing of the network output (thresholding after upsampling,
 * never upsampling a thresholded or already-squashed mask).
 */
export function logitsToProb(logits: Float32Array, size: number, width: number, height: number): Float32Array {
  const up = resizePlane(logits, size, size, width, height);
  for (let i = 0; i < up.length; i++) up[i] = sigmoid(up[i]);
  return up;
}

/** Probability plane -> soft mask bytes (0..255). */
export function probToMask(prob: Float32Array, width: number, height: number): MaskImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < prob.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, prob[i])) * 255);
  return { width, height, data };
}

/** Logits at model resolution -> soft mask (0..255) at the source resolution (see logitsToProb). */
export function logitsToMask(logits: Float32Array, size: number, width: number, height: number): MaskImage {
  return probToMask(logitsToProb(logits, size, width, height), width, height);
}

/** Binary 0/1 mask at threshold (default 0.5). */
export function binarize(mask: MaskImage, threshold = 128): Uint8Array {
  const out = new Uint8Array(mask.data.length);
  for (let i = 0; i < out.length; i++) out[i] = mask.data[i] >= threshold ? 1 : 0;
  return out;
}

/** 4-connected component labelling of a 0/1 mask; returns labels (0 = background) and areas (index = label). */
export function labelComponents(bin: Uint8Array, w: number, h: number): { labels: Int32Array; areas: number[] } {
  const labels = new Int32Array(w * h);
  const areas = [0];
  const stack: number[] = [];
  let next = 1;
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || labels[s]) continue;
    let area = 0;
    labels[s] = next;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      area++;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h || !bin[q] || labels[q]) continue;
        labels[q] = next;
        stack.push(q);
      }
    }
    areas.push(area);
    next++;
  }
  return { labels, areas };
}

/**
 * Clean-up after thresholding:
 *  - with positive clicks: keep only components that contain (or touch within 2 px of) a positive click
 *  - without clicks (subject): drop specks smaller than `minFrac` of the largest component
 */
export function cleanMask(bin: Uint8Array, w: number, h: number, clicks: SelectionClick[] = [], minFrac = 0.05): Uint8Array {
  const { labels, areas } = labelComponents(bin, w, h);
  if (areas.length <= 1) return bin;
  const keep = new Set<number>();
  const pos = clicks.filter((c) => c.positive);
  if (pos.length) {
    for (const c of pos) {
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const l = labels[y * w + x];
          if (l) keep.add(l);
        }
    }
    if (!keep.size) return bin; // click landed outside the predicted mask: leave it to the user
  } else {
    const max = Math.max(...areas.slice(1));
    areas.forEach((a, l) => {
      if (l && a >= minFrac * max) keep.add(l);
    });
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < out.length; i++) out[i] = keep.has(labels[i]) ? 1 : 0;
  return out;
}

/** Soft mask (0..255) -> alpha bytes at another resolution (bilinear / antialiased like resizePlane). */
export function upsampleMatte(mask: MaskImage, width: number, height: number): Uint8ClampedArray {
  const f = new Float32Array(mask.data.length);
  for (let i = 0; i < f.length; i++) f[i] = mask.data[i];
  const r = mask.width === width && mask.height === height ? f : resizePlane(f, mask.width, mask.height, width, height);
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < out.length; i++) out[i] = r[i];
  return out;
}
