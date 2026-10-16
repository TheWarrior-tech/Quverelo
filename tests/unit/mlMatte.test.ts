import { matteSubsample } from '../../src/core/ml/selectSubject';
import { describe, expect, it } from 'vitest';
import { boxMean, refineMatte } from '../../src/core/ml/matte';
import { resizePlane } from '../../src/core/ml/tensor';

/** Synthetic "portrait": a dark disc with thin dark hair strands on a light, slightly noisy background. */
function scene(W = 200, H = 160) {
  const data = new Uint8ClampedArray(W * H * 4);
  const gt = new Uint8Array(W * H);
  const cx = 100, cy = 90, R = 45;
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let fg = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
      // 7 one-pixel strands leaving the top of the head, 22 px long
      for (let k = 0; k < 7; k++) {
        const sx = cx - 30 + k * 10;
        const top = cy - Math.sqrt(Math.max(0, R * R - (sx - cx) ** 2));
        if (x === sx && y < top && y >= top - 22) fg = true;
      }
      gt[i] = fg ? 1 : 0;
      const n = (rnd() - 0.5) * 10;
      const c = fg ? [60, 40, 30] : [210, 220, 230];
      data[i * 4] = c[0] + n; data[i * 4 + 1] = c[1] + n; data[i * 4 + 2] = c[2] + n; data[i * 4 + 3] = 255;
    }
  return { img: { width: W, height: H, data }, gt, W, H };
}

/** What a low-resolution network gives: the GT seen at 1/8 resolution, upsampled (strands vanish, edge blurs). */
function blurryProb(gt: Uint8Array, W: number, H: number) {
  const f = new Float32Array(gt.length);
  for (let i = 0; i < gt.length; i++) f[i] = gt[i];
  const small = resizePlane(f, W, H, W / 8, H / 8);
  return resizePlane(small, W / 8, H / 8, W, H);
}

const iou = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) i++;
    if (a[k] || b[k]) u++;
  }
  return i / u;
};

describe('ML edge refinement (colour guided-filter matting)', () => {
  it('boxMean matches a brute-force window mean with clamped borders', () => {
    const w = 7, h = 5, r = 2;
    const src = new Float32Array(w * h).map((_, i) => (i * 37) % 11);
    const out = boxMean(src, w, h, r);
    for (const [x, y] of [[0, 0], [3, 2], [6, 4], [1, 3]]) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { s += src[yy * w + xx]; n++; }
      expect(out[y * w + x]).toBeCloseTo(s / n, 4);
    }
  });

  it('recovers hair strands and sharpens the edge that the low-res probability lost', () => {
    const { img, gt, W, H } = scene();
    const prob = blurryProb(gt, W, H);
    const before = Array.from(prob, (p) => (p >= 0.5 ? 1 : 0));
    const matte = refineMatte(img, prob, { band: 26 });
    const after = Array.from(matte.data, (v) => (v >= 128 ? 1 : 0));
    expect(iou(after, gt)).toBeGreaterThan(iou(before, gt));
    expect(iou(after, gt)).toBeGreaterThan(0.95);
    // strands: the blurry probability has (almost) none of them, the matte has most
    let strand = 0, hitBefore = 0, hitAfter = 0;
    const cx = 100, cy = 90, R = 45;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!gt[i] || (x - cx) ** 2 + (y - cy) ** 2 <= (R + 3) ** 2) continue;
        strand++; hitBefore += before[i]; hitAfter += matte.data[i] >= 128 ? 1 : 0;
      }
    expect(strand).toBeGreaterThan(80);
    expect(hitBefore / strand).toBeLessThan(0.2);
    expect(hitAfter / strand).toBeGreaterThan(0.6);
    // far background stays fully transparent, deep interior fully opaque
    expect(matte.data[5 * W + 5]).toBe(0);
    expect(matte.data[cy * W + cx]).toBe(255);
  });

  it('fast (subsampled) mode stays close to the exact filter', () => {
    const { img, gt, W, H } = scene();
    const prob = blurryProb(gt, W, H);
    const exact = refineMatte(img, prob, { subsample: 1, band: 26 });
    const fast = refineMatte(img, prob, { subsample: 2, band: 26 });
    expect(iou(Array.from(fast.data, (v) => v >= 128 ? 1 : 0), Array.from(exact.data, (v) => v >= 128 ? 1 : 0))).toBeGreaterThan(0.97);
  });

  it('fast mode keeps alpha close to the exact matte everywhere (not just the 0.5 cut)', () => {
    const { img, gt, W, H } = scene();
    const prob = blurryProb(gt, W, H);
    const exact = refineMatte(img, prob, { subsample: 1, band: 26 });
    const fast = refineMatte(img, prob, { subsample: 2, band: 26 });
    let d = 0, big = 0;
    for (let i = 0; i < exact.data.length; i++) {
      const e = Math.abs(exact.data[i] - fast.data[i]);
      d += e; if (e > 64) big++;
    }
    expect(d / exact.data.length / 255).toBeLessThan(0.01);
    expect(big / exact.data.length).toBeLessThan(0.01);
  });

  it('Select Subject uses the fast matte above 640 px (the 1024 px analysis), exact below', () => {
    expect(matteSubsample(1024, 687)).toBe(2);
    expect(matteSubsample(640, 480)).toBe(1);
    expect(matteSubsample(300, 900)).toBe(2);
  });

  it('refines a 1024 x 768 image quickly', () => {
    const W = 1024, H = 768;
    const data = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 255));
    const prob = new Float32Array(W * H).map((_, i) => ((i % W) > 300 && (i % W) < 700 ? 0.9 : 0.1));
    const t0 = performance.now();
    const m = refineMatte({ width: W, height: H, data }, prob);
    const ms = performance.now() - t0;
    expect(m.data.length).toBe(W * H);
    expect(ms).toBeLessThan(2500); // CI-safe bound; typical figure is in ml/MODEL_CARD.md
  });
});
