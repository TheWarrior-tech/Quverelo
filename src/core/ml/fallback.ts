/**
 * Non-ML fallbacks used when the ONNX model can't load (missing file, no WASM, out of memory).
 * Deliberately simple and deterministic.
 *
 *  - subjectFallback: colour-contrast saliency against the image border with a centre prior,
 *    Otsu threshold, then keep the main components.
 *  - clickFallback:   colour region-growing from positive clicks (union), minus regions grown from
 *    negative clicks.
 */
import { cleanMask, type MaskImage, type RgbaImage } from './tensor';
import type { SelectionClick } from './clickMaps';

const WORK = 96; // fallback works on a small grid, then upsamples

function downsample(img: RgbaImage, s: number): Float32Array {
  const { width: W, height: H, data } = img;
  const out = new Float32Array(s * s * 3);
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const sx = Math.min(W - 1, Math.floor(((x + 0.5) * W) / s));
      const sy = Math.min(H - 1, Math.floor(((y + 0.5) * H) / s));
      const i = (sy * W + sx) * 4;
      const a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) out[(y * s + x) * 3 + c] = data[i + c] * a + 255 * (1 - a);
    }
  return out;
}

/** Otsu threshold of values in [0, 1]. */
export function otsu(values: Float32Array): number {
  const bins = 64;
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let thr = 0.5;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = (i + 1) / bins;
    }
  }
  return thr;
}

function upsampleNearest(bin: Uint8Array, s: number, W: number, H: number): MaskImage {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(s - 1, Math.floor(((y + 0.5) * s) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(s - 1, Math.floor(((x + 0.5) * s) / W));
      data[y * W + x] = bin[sy * s + sx] ? 255 : 0;
    }
  }
  return { width: W, height: H, data };
}

export function subjectFallback(img: RgbaImage): MaskImage {
  const s = WORK;
  const px = downsample(img, s);
  // border colour samples
  const border: number[][] = [];
  for (let i = 0; i < s; i += 3) {
    for (const [x, y] of [[i, 0], [i, s - 1], [0, i], [s - 1, i]]) {
      const k = (y * s + x) * 3;
      border.push([px[k], px[k + 1], px[k + 2]]);
    }
  }
  const sal = new Float32Array(s * s);
  let max = 1e-6;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const k = (y * s + x) * 3;
      let dmin = Infinity;
      for (const b of border) {
        const d = (px[k] - b[0]) ** 2 + (px[k + 1] - b[1]) ** 2 + (px[k + 2] - b[2]) ** 2;
        if (d < dmin) dmin = d;
      }
      const cx = (x + 0.5) / s - 0.5;
      const cy = (y + 0.5) / s - 0.5;
      const prior = Math.exp(-(cx * cx + cy * cy) / (2 * 0.3 * 0.3));
      const v = Math.sqrt(dmin) * prior;
      sal[y * s + x] = v;
      if (v > max) max = v;
    }
  for (let i = 0; i < sal.length; i++) sal[i] /= max;
  const t = otsu(sal);
  let bin: Uint8Array = new Uint8Array(s * s);
  for (let i = 0; i < bin.length; i++) bin[i] = sal[i] > t ? 1 : 0;
  bin = cleanMask(bin, s, s, [], 0.2);
  return upsampleNearest(bin, s, img.width, img.height);
}

function grow(px: Float32Array, s: number, sx: number, sy: number, tol: number): Uint8Array {
  const m = new Uint8Array(s * s);
  const k0 = (sy * s + sx) * 3;
  const r = px[k0], g = px[k0 + 1], b = px[k0 + 2];
  const t2 = tol * tol * 3;
  const st = [sy * s + sx];
  while (st.length) {
    const p = st.pop()!;
    if (m[p]) continue;
    const k = p * 3;
    if ((px[k] - r) ** 2 + (px[k + 1] - g) ** 2 + (px[k + 2] - b) ** 2 > t2) continue;
    m[p] = 1;
    const x = p % s;
    if (x > 0) st.push(p - 1);
    if (x < s - 1) st.push(p + 1);
    if (p >= s) st.push(p - s);
    if (p < s * s - s) st.push(p + s);
  }
  return m;
}

export function clickFallback(img: RgbaImage, clicks: SelectionClick[], tolerance = 40): MaskImage {
  const s = WORK * 2;
  const px = downsample(img, s);
  const bin = new Uint8Array(s * s);
  const at = (c: SelectionClick) => [
    Math.min(s - 1, Math.max(0, Math.floor(((c.x + 0.5) * s) / img.width))),
    Math.min(s - 1, Math.max(0, Math.floor(((c.y + 0.5) * s) / img.height))),
  ];
  for (const c of clicks.filter((c) => c.positive)) {
    const [x, y] = at(c);
    const g = grow(px, s, x, y, tolerance);
    for (let i = 0; i < bin.length; i++) if (g[i]) bin[i] = 1;
  }
  for (const c of clicks.filter((c) => !c.positive)) {
    const [x, y] = at(c);
    const g = grow(px, s, x, y, tolerance);
    for (let i = 0; i < bin.length; i++) if (g[i]) bin[i] = 0;
  }
  return upsampleNearest(bin, s, img.width, img.height);
}
