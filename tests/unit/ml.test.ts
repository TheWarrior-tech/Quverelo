import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLICK_SIGMA_FRAC, encodeClicks } from '../../src/core/ml/clickMaps';
import { binarize, buildInput, cleanMask, logitsToMask, MEAN, resizePlane, STD, type RgbaImage } from '../../src/core/ml/tensor';
import { loopArea, maskToPath, simplifyLoop, traceMaskLoops } from '../../src/core/ml/maskToPath';
import { otsu, subjectFallback, clickFallback } from '../../src/core/ml/fallback';
import { selectObject, selectSubject, type SegmentationBackend } from '../../src/core/ml/selectSubject';

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, '../fixtures/ml', name), 'utf8'));

function solid(w: number, h: number, rgba: [number, number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

/** white image with a dark square in the middle */
function squareImage(w: number, h: number, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const img = solid(w, h, [250, 250, 250, 255]);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([30, 60, 140, 255], (y * w + x) * 4);
  return img;
}

function iou(a: Uint8Array, b: Uint8Array) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] && b[k]) i++;
    if (a[k] || b[k]) u++;
  }
  return u ? i / u : 1;
}

describe('click maps', () => {
  it('matches the Python training encoding exactly', () => {
    const f = fixture('clickmap.json');
    expect(f.sigma_frac).toBe(CLICK_SIGMA_FRAC);
    const m = encodeClicks(f.w, f.h, f.points);
    let maxErr = 0;
    for (let i = 0; i < m.length; i++) maxErr = Math.max(maxErr, Math.abs(m[i] - f.map[i]));
    expect(maxErr).toBeLessThan(1e-4);
  });
  it('peaks at the click and scales source coordinates to the model grid', () => {
    const m = encodeClicks(100, 100, [{ x: 399.5, y: 199.5 }], 800, 400);
    // source pixel centre (399.5+0.5)/800*100-0.5 = 49.5 -> between 49 and 50
    expect(m[49 * 100 + 49]).toBeGreaterThan(0.9);
    expect(m[0]).toBe(0);
  });
});

describe('tensor pre/post-processing', () => {
  it('resizePlane keeps constants and is exact for identity', () => {
    const p = new Float32Array([1, 2, 3, 4]);
    expect(Array.from(resizePlane(p, 2, 2, 2, 2))).toEqual([1, 2, 3, 4]);
    const c = resizePlane(new Float32Array(9).fill(0.25), 3, 3, 7, 5);
    expect(c.every((v) => Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });
  it('resizePlane matches PIL BILINEAR (the training resize) for shrink and enlarge', () => {
    const f = fixture('resize_pil.json');
    const src = new Float32Array(f.src);
    for (const c of f.cases) {
      const r = resizePlane(src, f.sw, f.sh, c.dw, c.dh);
      let maxErr = 0;
      for (let i = 0; i < r.length; i++) maxErr = Math.max(maxErr, Math.abs(r[i] - c.out[i]));
      expect(maxErr, `${c.dw}x${c.dh}`).toBeLessThan(1e-3);
    }
  });
  it('normalises RGB with ImageNet stats and composites alpha on white', () => {
    const t = buildInput(solid(10, 6, [0, 0, 0, 0]), [], null, 32);
    const n = 32 * 32;
    for (let c = 0; c < 3; c++) expect(t[c * n + 5]).toBeCloseTo((1 - MEAN[c]) / STD[c], 5);
    const t2 = buildInput(solid(10, 6, [0, 0, 0, 255]), [{ x: 5, y: 3, positive: true }], null, 32);
    expect(t2[0]).toBeCloseTo(-MEAN[0] / STD[0], 5);
    // pos map populated, neg map and prev mask empty
    expect(Math.max(...t2.subarray(3 * n, 4 * n))).toBeGreaterThan(0.8);
    expect(Math.max(...t2.subarray(4 * n, 6 * n))).toBe(0);
    expect(t2.length).toBe(6 * n);
  });
  it('encodes the previous mask as 0/1', () => {
    const prev = { width: 4, height: 4, data: new Uint8Array(16).fill(255) };
    const t = buildInput(solid(4, 4, [9, 9, 9, 255]), [], prev, 32);
    expect(t.subarray(5 * 1024).every((v) => v === 1)).toBe(true);
  });
  it('logits -> soft mask at source size', () => {
    const logits = new Float32Array(16).fill(-8);
    logits[5] = logits[6] = logits[9] = logits[10] = 8;
    const m = logitsToMask(logits, 4, 8, 8);
    expect(m.width).toBe(8);
    expect(m.data[0]).toBeLessThan(5);
    expect(m.data[3 * 8 + 3]).toBeGreaterThan(250);
    expect(logitsToMask(new Float32Array(4), 2, 2, 2).data[0]).toBe(128);
  });
  it('cleanMask keeps the clicked component, or drops specks for subjects', () => {
    const w = 10, h = 10;
    const bin = new Uint8Array(w * h);
    for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) bin[y * w + x] = 1; // 16 px
    bin[8 * w + 8] = 1; // 1 px speck
    for (let y = 6; y < 9; y++) for (let x = 1; x < 4; x++) bin[y * w + x] = 1; // 9 px
    const clicked = cleanMask(bin, w, h, [{ x: 2, y: 7, positive: true }]);
    expect(clicked.reduce((a, b) => a + b, 0)).toBe(9);
    const subj = cleanMask(bin, w, h, [], 0.25);
    expect(subj.reduce((a, b) => a + b, 0)).toBe(25);
  });
});

describe('mask -> path', () => {
  it('traces a square as one clockwise 4-corner loop', () => {
    const w = 8, h = 8;
    const bin = new Uint8Array(w * h);
    for (let y = 2; y < 6; y++) for (let x = 1; x < 5; x++) bin[y * w + x] = 1;
    const loops = traceMaskLoops(bin, w, h);
    expect(loops.length).toBe(1);
    expect(loopArea(loops[0])).toBe(16);
    const s = simplifyLoop(loops[0]);
    expect(s.length).toBe(4);
    const d = maskToPath(bin, w, h)!;
    expect(d[0][0]).toBe('M');
    expect(d[d.length - 1][0]).toBe('Z');
  });
  it('emits holes as separate loops of opposite orientation', () => {
    const w = 9, h = 9;
    const bin = new Uint8Array(w * h);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) bin[y * w + x] = 1;
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) bin[y * w + x] = 0;
    const loops = traceMaskLoops(bin, w, h);
    expect(loops.length).toBe(2);
    const areas = loops.map(loopArea).sort((a, b) => a - b);
    expect(areas).toEqual([-9, 49]);
  });
  it('returns null for an empty mask and drops specks below minArea', () => {
    expect(maskToPath(new Uint8Array(16), 4, 4)).toBeNull();
    const one = new Uint8Array(16);
    one[5] = 1;
    expect(maskToPath(one, 4, 4, { minArea: 2 })).toBeNull();
  });
});

describe('fallbacks', () => {
  it('otsu splits a bimodal distribution', () => {
    const v = new Float32Array(200);
    for (let i = 0; i < 100; i++) v[i] = 0.1;
    for (let i = 100; i < 200; i++) v[i] = 0.9;
    const t = otsu(v);
    expect(t).toBeGreaterThan(0.1);
    expect(t).toBeLessThanOrEqual(0.9);
  });
  it('subject fallback finds a centred object on a plain background', () => {
    const img = squareImage(120, 90, 40, 25, 80, 65);
    const m = subjectFallback(img);
    const gt = new Uint8Array(120 * 90);
    for (let y = 25; y < 65; y++) for (let x = 40; x < 80; x++) gt[y * 120 + x] = 1;
    expect(iou(binarize(m), gt)).toBeGreaterThan(0.8);
  });
  it('click fallback grows from positive clicks only', () => {
    const img = squareImage(60, 60, 10, 10, 30, 30);
    const m = clickFallback(img, [{ x: 20, y: 20, positive: true }]);
    const b = binarize(m);
    expect(b[20 * 60 + 20]).toBe(1);
    expect(b[50 * 60 + 50]).toBe(0);
  });
});

describe('selectSubject / selectObject', () => {
  const img = squareImage(64, 48, 16, 12, 48, 36);
  const fake = (fn: (input: Float32Array, size: number) => Float32Array): SegmentationBackend => ({ name: 'fake', run: async (i, s) => fn(i, s) });

  it('uses the ML backend when it works', async () => {
    let seen = 0;
    const backend = fake((input, size) => {
      seen = input.length;
      const out = new Float32Array(size * size).fill(-10);
      for (let y = size / 4; y < (3 * size) / 4; y++) for (let x = size / 4; x < (3 * size) / 4; x++) out[y * size + x] = 10;
      return out;
    });
    const r = await selectSubject(img, { backend, size: 64 });
    expect(seen).toBe(6 * 64 * 64);
    expect(r.source).toBe('ml');
    expect(r.binary[24 * 64 + 32]).toBe(1);
    expect(r.binary[0]).toBe(0);
  });
  it('falls back (and reports why) when the backend throws or returns the wrong shape', async () => {
    const r = await selectSubject(img, { backend: fake(() => { throw new Error('no wasm'); }) });
    expect(r.source).toBe('fallback');
    expect(r.error).toBe('no wasm');
    const r2 = await selectSubject(img, { backend: fake(() => new Float32Array(3)), size: 32 });
    expect(r2.source).toBe('fallback');
    expect(r2.binary[24 * 64 + 32]).toBe(1);
  });
  it('passes clicks and the previous mask to the backend', async () => {
    let pos = 0, prev = 0;
    const backend = fake((input, size) => {
      const n = size * size;
      pos = Math.max(...input.subarray(3 * n, 4 * n));
      prev = input.subarray(5 * n).reduce((a, b) => a + b, 0);
      return new Float32Array(n).fill(5);
    });
    const previous = { width: 64, height: 48, data: new Uint8Array(64 * 48).fill(255) };
    const r = await selectObject(img, [{ x: 30, y: 20, positive: true }], { backend, size: 32, previous });
    expect(pos).toBeGreaterThan(0.5);
    expect(prev).toBe(32 * 32);
    expect(r.source).toBe('ml');
  });
  it('selectObject without positive clicks behaves like selectSubject', async () => {
    const r = await selectObject(img, [{ x: 1, y: 1, positive: false }]);
    expect(r.source).toBe('fallback');
    expect(r.binary[24 * 64 + 32]).toBe(1);
  });
});
