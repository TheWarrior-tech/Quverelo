/**
 * Photo parity maths: blend modes, new adjustments and filters, selection
 * masks (refine edge, colour range), resampling, straighten, liquify,
 * retouching dabs and histogram statistics.
 */
import { describe, expect, it } from 'vitest';
import { blendChannel, blendColor, compositeBuffers, compositePixel, isNativeBlend, BLEND_LABELS } from '../../src/core/blend';
import { ALL_BLEND_MODES, BLEND_MODES, EXTENDED_BLEND_MODES } from '../../src/core/types';
import { ADJUSTMENTS, applyAdjustment, createPixels, defaultParams, type Pixels } from '../../src/core/pixels';
import { colorBalance, gradientLut, gradientMap, lumaStdDev, motionBlur, reduceNoise, toneWeights } from '../../src/core/photoFilters';
import { binarize, blurMask, colorRangeMask, combineMasks, coverage, effectiveFeather, maskBounds, refineMask } from '../../src/core/selectionMask';
import { anchorOffset, resample, straightenCrop } from '../../src/core/resample';
import { applyDab, createField, falloff, maxDisplacement, warp } from '../../src/core/liquify';
import { cloneDab, createSmudge, dodgeBurnDab, healDab, rangeWeight, smudgeDab, spotHealDab, tipWeight } from '../../src/core/retouch';
import { histStats, rangeShare } from '../../src/core/histogramStats';
import { histogram } from '../../src/core/pixels';

const px = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Pixels => {
  const p = createPixels(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(f(x, y), (y * w + x) * 4);
  return p;
};
const at = (p: Pixels, x: number, y: number) => [...p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

describe('blend modes', () => {
  it('lists 16 native + 8 extended modes, all labelled, in one menu order', () => {
    expect(BLEND_MODES).toHaveLength(16);
    expect(EXTENDED_BLEND_MODES).toHaveLength(8);
    expect(new Set(ALL_BLEND_MODES)).toEqual(new Set([...BLEND_MODES, ...EXTENDED_BLEND_MODES]));
    for (const m of ALL_BLEND_MODES) expect(BLEND_LABELS[m]).toMatch(/^[A-Z][a-z ()]+$/);
    expect(BLEND_MODES.every(isNativeBlend)).toBe(true);
    expect(EXTENDED_BLEND_MODES.some(isNativeBlend)).toBe(false);
  });

  it('separable formulas (W3C compositing spec + Photoshop extras)', () => {
    const b = 0.4, s = 0.7;
    expect(blendChannel('multiply', b, s)).toBeCloseTo(0.28);
    expect(blendChannel('screen', b, s)).toBeCloseTo(0.82);
    expect(blendChannel('overlay', b, s)).toBeCloseTo(2 * b * s); // b <= .5
    expect(blendChannel('darken', b, s)).toBe(0.4);
    expect(blendChannel('lighten', b, s)).toBe(0.7);
    expect(blendChannel('color-dodge', b, s)).toBeCloseTo(1); // 0.4 / 0.3 clamps
    expect(blendChannel('color-burn', b, s)).toBeCloseTo(1 - 0.6 / 0.7);
    expect(blendChannel('hard-light', b, s)).toBeCloseTo(b + (2 * s - 1) - b * (2 * s - 1));
    expect(blendChannel('soft-light', b, 0.2)).toBeCloseTo(b - (1 - 0.4) * b * (1 - b));
    expect(blendChannel('difference', b, s)).toBeCloseTo(0.3);
    expect(blendChannel('exclusion', b, s)).toBeCloseTo(b + s - 2 * b * s);
    expect(blendChannel('linear-burn', b, s)).toBeCloseTo(0.1);
    expect(blendChannel('linear-dodge', b, s)).toBeCloseTo(1);
    expect(blendChannel('linear-light', b, s)).toBeCloseTo(0.8);
    expect(blendChannel('pin-light', b, 0.1)).toBeCloseTo(0.2);
    expect(blendChannel('hard-mix', b, s)).toBe(1);
    expect(blendChannel('hard-mix', 0.2, 0.3)).toBe(0);
    expect(blendChannel('subtract', s, b)).toBeCloseTo(0.3);
    expect(blendChannel('divide', b, 0.8)).toBeCloseTo(0.5);
    expect(blendChannel('vivid-light', b, 0.25)).toBeCloseTo(1 - Math.min(1, 0.6 / 0.5));
  });

  it('non-separable modes keep the right components', () => {
    const red: [number, number, number] = [1, 0, 0];
    const grey: [number, number, number] = [0.5, 0.5, 0.5];
    const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    // luminosity of the source, hue/sat of the backdrop
    expect(lum(blendColor('luminosity', red, grey))).toBeCloseTo(0.5, 2);
    // colour onto grey takes the source hue and keeps the backdrop's luminosity
    const c = blendColor('color', grey, red);
    expect(lum(c)).toBeCloseTo(0.5, 2);
    expect(c[0]).toBeGreaterThan(c[1]);
    // saturation of grey removes colour
    const s = blendColor('saturation', red, grey);
    expect(Math.max(...s) - Math.min(...s)).toBeCloseTo(0, 5);
  });

  it('composites with opacity and alpha (source-over with blending)', () => {
    const o = compositePixel('normal', [0, 0, 1], 1, [1, 0, 0], 0.25);
    expect(o[0]).toBeCloseTo(0.25);
    expect(o[2]).toBeCloseTo(0.75);
    expect(o[3]).toBeCloseTo(1);
    // over transparent the blend function is ignored (W3C: Cs' = Cs when ab = 0)
    const t = compositePixel('multiply', [0, 0, 0], 0, [1, 0.5, 0], 1);
    expect(t.slice(0, 3)).toEqual([1, 0.5, 0]);
    const dst = new Uint8ClampedArray([100, 100, 100, 255, 0, 0, 0, 0]);
    const src = new Uint8ClampedArray([200, 50, 0, 255, 200, 50, 0, 255]);
    compositeBuffers(dst, src, 'difference', 1);
    expect([...dst.slice(0, 4)]).toEqual([100, 50, 100, 255]);
    expect([...dst.slice(4)]).toEqual([200, 50, 0, 255]);
  });
});

describe('new adjustments and filters', () => {
  it('registers every adjustment with defaults; filters are flagged', () => {
    for (const t of ['color-balance', 'gradient-map', 'motion-blur', 'reduce-noise'] as const) expect(ADJUSTMENTS.find((a) => a.type === t)).toBeTruthy();
    expect(ADJUSTMENTS.filter((a) => a.filter).map((a) => a.type).sort()).toEqual(['blur', 'motion-blur', 'noise', 'reduce-noise', 'sharpen', 'vignette'].sort());
    expect(defaultParams('color-balance').preserveLuminosity).toBe(1);
  });

  it('colour balance shifts the chosen tonal range and preserves luminosity on request', () => {
    const w = toneWeights(0.5);
    expect(w.midtones).toBeGreaterThan(w.shadows);
    expect(w.midtones).toBeGreaterThan(w.highlights);
    const grey = px(1, 1, () => [128, 128, 128, 255]);
    const p = { ...defaultParams('color-balance'), midtonesCR: 100, preserveLuminosity: 0 } as never;
    const out = colorBalance(grey, p);
    expect(out.data[0]).toBeGreaterThan(160);
    const kept = colorBalance(grey, { ...defaultParams('color-balance'), midtonesCR: 100 } as never);
    const l = (d: Uint8ClampedArray) => (Math.max(d[0], d[1], d[2]) + Math.min(d[0], d[1], d[2])) / 2;
    expect(Math.abs(l(kept.data) - 128)).toBeLessThan(2);
    expect(kept.data[0]).toBeGreaterThan(kept.data[2]);
  });

  it('gradient map maps luminance onto the ramp (and reverses)', () => {
    const lut = gradientLut([{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }]);
    expect([lut[0], lut[2]]).toEqual([255, 0]);
    expect([lut[255 * 3], lut[255 * 3 + 2]]).toEqual([0, 255]);
    const black = px(1, 1, () => [0, 0, 0, 255]);
    expect(at(gradientMap(black, [{ offset: 0, color: '#112233' }, { offset: 1, color: '#ffffff' }]), 0, 0).slice(0, 3)).toEqual([0x11, 0x22, 0x33]);
    expect(at(gradientMap(black, [{ offset: 0, color: '#112233' }, { offset: 1, color: '#ffffff' }], true), 0, 0).slice(0, 3)).toEqual([255, 255, 255]);
    const viaAdj = applyAdjustment(black, { type: 'gradient-map', params: { reverse: 0 }, stops: [{ offset: 0, color: '#00ff00' }, { offset: 1, color: '#000000' }] });
    expect(at(viaAdj, 0, 0).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it('motion blur streaks along the angle only', () => {
    const dot = px(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const h = motionBlur(dot, 0, 9);
    expect(at(h, 14, 10)[0]).toBeGreaterThan(20); // spread horizontally
    expect(at(h, 10, 14)[0]).toBe(0); // not vertically
    const v = motionBlur(dot, 90, 9);
    expect(at(v, 10, 14)[0]).toBeGreaterThan(20);
    expect(at(v, 14, 10)[0]).toBe(0);
  });

  it('reduce noise lowers variance but keeps a hard edge', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const noisy = px(32, 32, (x) => {
      const base = x < 16 ? 60 : 200;
      const n = base + (rnd() - 0.5) * 30;
      return [n, n, n, 255];
    });
    const out = reduceNoise(noisy, 60, 2, 0);
    const half = (p: Pixels, x0: number) => lumaStdDev({ width: 12, height: 32, data: new Uint8ClampedArray(Array.from({ length: 32 }, (_, y) => Array.from({ length: 12 }, (_, x) => at(p, x0 + x, y))).flat(2)) });
    expect(half(out, 2)).toBeLessThan(half(noisy, 2) * 0.6);
    expect(at(out, 15, 16)[0]).toBeLessThan(100); // edge not smeared across
    expect(at(out, 16, 16)[0]).toBeGreaterThan(160);
  });
});

describe('selection masks', () => {
  const square = () => {
    const m = new Uint8ClampedArray(64 * 64);
    for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) m[y * 64 + x] = 255;
    return m;
  };
  it('feather blurs; shift edge grows and shrinks by about the given px', () => {
    const m = square();
    const f = blurMask(m, 64, 64, 8);
    expect(f[32 * 64 + 16]).toBeGreaterThan(64);
    expect(f[32 * 64 + 16]).toBeLessThan(192);
    const grow = maskBounds(refineMask(m, 64, 64, { smooth: 0, feather: 0, contrast: 0, shift: 6 }), 64, 64, 128)!;
    expect(grow.w).toBeGreaterThanOrEqual(32 + 9);
    expect(grow.w).toBeLessThanOrEqual(32 + 15);
    const shrink = maskBounds(refineMask(m, 64, 64, { smooth: 0, feather: 0, contrast: 0, shift: -6 }), 64, 64, 128)!;
    expect(shrink.w).toBeLessThanOrEqual(32 - 9);
    expect(shrink.w).toBeGreaterThanOrEqual(32 - 15);
    expect(effectiveFeather({ smooth: 0, feather: 10, contrast: 0, shift: 0 })).toBe(10);
    expect(effectiveFeather({ smooth: 0, feather: 10, contrast: 50, shift: 0 })).toBeLessThan(2);
  });
  it('smooth rounds corners without moving straight edges', () => {
    const s = refineMask(square(), 64, 64, { smooth: 6, feather: 0, contrast: 0, shift: 0 });
    expect(s[16 * 64 + 16]).toBe(0); // corner rounded off
    expect(s[32 * 64 + 17]).toBe(255); // edge middle kept
  });
  it('colour range picks by colour distance and tonal range', () => {
    const p = px(4, 1, (x) => [[250, 10, 10, 255], [200, 60, 60, 255], [10, 10, 250, 255], [128, 128, 128, 255]][x] as [number, number, number, number]);
    const m = colorRangeMask(p, 'sampled', [250, 10, 10], 40);
    expect(m[0]).toBe(255);
    expect(m[2]).toBe(0);
    expect(colorRangeMask(p, 'reds', [0, 0, 0], 0)[0]).toBe(255);
    expect(colorRangeMask(p, 'blues', [0, 0, 0], 0)[2]).toBe(255);
    expect(colorRangeMask(p, 'midtones', [0, 0, 0], 0)[3]).toBe(255);
  });
  it('combines, binarises and measures masks', () => {
    const a = new Uint8ClampedArray([255, 255, 0, 0]);
    const b = new Uint8ClampedArray([0, 255, 255, 0]);
    expect([...combineMasks(a, b, 'add')]).toEqual([255, 255, 255, 0]);
    expect([...combineMasks(a, b, 'subtract')]).toEqual([255, 0, 0, 0]);
    expect([...combineMasks(a, b, 'intersect')]).toEqual([0, 255, 0, 0]);
    expect([...combineMasks(null, b, 'add')]).toEqual([...b]);
    expect([...binarize(new Uint8ClampedArray([10, 200]))]).toEqual([0, 1]);
    expect(coverage(a)).toBeCloseTo(0.5);
  });
});

describe('resampling, canvas size, straighten', () => {
  const grad = px(8, 8, (x) => [x * 32, x * 32, x * 32, 255]);
  it('every method resizes; nearest keeps hard pixels, others interpolate', () => {
    for (const m of ['nearest', 'bilinear', 'bicubic', 'lanczos3'] as const) {
      const up = resample(grad, 16, 16, m);
      expect([up.width, up.height]).toEqual([16, 16]);
      const down = resample(grad, 4, 4, m);
      expect([down.width, down.height]).toEqual([4, 4]);
      // mean brightness preserved (nearest samples, so it may shift by a step)
      if (m === 'nearest') continue;
      const mean = (p: Pixels) => { let s = 0; for (let i = 0; i < p.data.length; i += 4) s += p.data[i]; return s / (p.data.length / 4); };
      expect(Math.abs(mean(down) - mean(grad))).toBeLessThan(6);
    }
    const near = resample(grad, 16, 16, 'nearest');
    expect(at(near, 2, 0)[0]).toBe(at(near, 3, 0)[0]);
    const bil = resample(grad, 16, 16, 'bilinear');
    expect(at(bil, 2, 0)[0]).not.toBe(at(bil, 3, 0)[0]);
  });
  it('downscaling averages (no aliasing of a fine checker)', () => {
    const chk = px(64, 64, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    for (const m of ['bilinear', 'bicubic', 'lanczos3'] as const) {
      const d = resample(chk, 8, 8, m);
      expect(Math.abs(at(d, 4, 4)[0] - 128)).toBeLessThan(20);
    }
  });
  it('premultiplied: a transparent neighbour does not darken the edge', () => {
    const p = px(2, 1, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const d = resample(p, 4, 1, 'bilinear');
    expect(at(d, 1, 0)[0]).toBeGreaterThan(250);
  });
  it('anchors and straighten crop', () => {
    expect(anchorOffset(100, 50, 200, 150, 'c')).toEqual({ dx: 50, dy: 50 });
    expect(anchorOffset(100, 50, 200, 150, 'tl')).toEqual({ dx: 0, dy: 0 });
    expect(anchorOffset(100, 50, 200, 150, 'br')).toEqual({ dx: 100, dy: 100 });
    expect(straightenCrop(400, 300, 0)).toEqual({ w: 400, h: 300 });
    const s = straightenCrop(400, 300, 5);
    expect(s.w / s.h).toBeCloseTo(400 / 300);
    expect(s.w).toBeLessThan(400);
    // the rotated corners of the crop stay inside the image
    const t = (5 * Math.PI) / 180;
    expect(s.w * Math.cos(t) + s.h * Math.sin(t)).toBeLessThanOrEqual(400 + 1e-6);
    expect(s.w * Math.sin(t) + s.h * Math.cos(t)).toBeLessThanOrEqual(300 + 1e-6);
  });
});

describe('liquify', () => {
  const stripes = () => px(40, 40, (x) => (x >= 18 && x < 22 ? [255, 0, 0, 255] : [255, 255, 255, 255]));
  it('push moves content along the stroke; reconstruct restores it', () => {
    const f = createField(40, 40);
    applyDab(f, 'push', { x: 20, y: 20, radius: 10, strength: 1, vx: 5, vy: 0 });
    expect(maxDisplacement(f)).toBeGreaterThan(4);
    const out = warp(stripes(), f);
    expect(at(out, 24, 20)[1]).toBeLessThan(100); // the red stripe moved right
    for (let k = 0; k < 10; k++) applyDab(f, 'reconstruct', { x: 20, y: 20, radius: 12, strength: 1 });
    expect(maxDisplacement(f)).toBeLessThan(0.5);
  });
  it('pinch and bloat move pixels towards / away from the centre; twirl rotates', () => {
    const ring = () => px(41, 41, (x, y) => (Math.abs(Math.hypot(x - 20, y - 20) - 8) < 1.2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const fb = createField(41, 41);
    applyDab(fb, 'bloat', { x: 20, y: 20, radius: 16, strength: 1 });
    expect(at(warp(ring(), fb), 30, 20)[0]).toBeLessThan(200); // ring pushed outwards
    const fp = createField(41, 41);
    applyDab(fp, 'pinch', { x: 20, y: 20, radius: 16, strength: 1 });
    expect(at(warp(ring(), fp), 26, 20)[0]).toBeLessThan(200); // ring pulled in
    const ft = createField(41, 41);
    applyDab(ft, 'twirl-cw', { x: 20, y: 20, radius: 16, strength: 1 });
    expect(maxDisplacement(ft)).toBeGreaterThan(0.5);
    expect(falloff(0, 10)).toBe(1);
    expect(falloff(10, 10)).toBe(0);
  });
});

describe('retouch dabs', () => {
  it('tip weight follows hardness; range weights favour their range', () => {
    expect(tipWeight(0, 10, 0.5)).toBe(1);
    expect(tipWeight(4, 10, 0.5)).toBe(1);
    expect(tipWeight(7.5, 10, 0.5)).toBeCloseTo(0.5, 1);
    expect(tipWeight(10, 10, 0.5)).toBe(0);
    expect(rangeWeight(0.1, 'shadows')).toBeGreaterThan(rangeWeight(0.1, 'highlights'));
    expect(rangeWeight(0.5, 'midtones')).toBe(1);
  });
  it('clone copies from the offset, inside the selection only', () => {
    const src = px(30, 10, (x) => (x < 10 ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    const work = px(30, 10, (x) => (x < 10 ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    const sel = new Uint8ClampedArray(300);
    for (let y = 0; y < 10; y++) for (let x = 15; x < 30; x++) sel[y * 30 + x] = 255;
    cloneDab(work, src, { x: 15, y: 5, r: 4, hardness: 1, alpha: 1 }, -10, 0, sel);
    expect(at(work, 16, 5).slice(0, 3)).toEqual([255, 0, 0]);
    expect(at(work, 13, 5).slice(0, 3)).toEqual([255, 255, 255]); // outside the selection
  });
  it('healing keeps the destination tone and brings the source texture', () => {
    // source: textured grey around 100; destination: flat 200
    const src = px(40, 20, (x, y) => (x < 20 ? [100 + ((x + y) % 2) * 40, 100 + ((x + y) % 2) * 40, 100 + ((x + y) % 2) * 40, 255] : [200, 200, 200, 255]));
    const work = px(40, 20, (x, y) => (x < 20 ? [100 + ((x + y) % 2) * 40, 100 + ((x + y) % 2) * 40, 100 + ((x + y) % 2) * 40, 255] : [200, 200, 200, 255]));
    healDab(work, src, { x: 30, y: 10, r: 6, hardness: 1, alpha: 1 }, -20, 0);
    const a = at(work, 30, 10)[0], b = at(work, 31, 10)[0];
    expect(Math.abs(a - b)).toBeGreaterThan(20); // texture arrived
    expect(Math.abs((a + b) / 2 - 220)).toBeLessThan(30); // tone stays near the destination (200 + texture mean offset)
  });
  it('spot healing removes a small spot', () => {
    const p = px(60, 60, (x, y) => (Math.hypot(x - 30, y - 30) < 3 ? [20, 20, 20, 255] : [180, 170, 160, 255]));
    spotHealDab(p, { x: 30, y: 30, r: 6, hardness: 0.5, alpha: 1 });
    expect(at(p, 30, 30)[0]).toBeGreaterThan(140);
  });
  it('dodge lightens, burn darkens, smudge drags colour', () => {
    const p = px(20, 20, () => [100, 100, 100, 255]);
    dodgeBurnDab(p, { x: 10, y: 10, r: 5, hardness: 1, alpha: 1 }, false, 'midtones', 0.5);
    expect(at(p, 10, 10)[0]).toBeGreaterThan(130);
    const q = px(20, 20, () => [100, 100, 100, 255]);
    dodgeBurnDab(q, { x: 10, y: 10, r: 5, hardness: 1, alpha: 1 }, true, 'midtones', 0.5);
    expect(at(q, 10, 10)[0]).toBeLessThan(70);
    const s = px(40, 10, (x) => (x < 10 ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    const st = createSmudge(4);
    for (let x = 5; x <= 20; x++) smudgeDab(s, st, { x, y: 5, r: 4, hardness: 1, alpha: 1 }, 0.8);
    expect(at(s, 15, 5)[1]).toBeLessThan(220); // red carried into the white
  });
});

describe('histogram statistics', () => {
  it('mean, std dev, median, clipping', () => {
    const p = px(4, 1, (x) => [[0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255], [128, 128, 128, 255]][x] as [number, number, number, number]);
    const h = histogram(p);
    const s = histStats(h.r);
    expect(s.pixels).toBe(4);
    expect(s.mean).toBeCloseTo((255 + 128) / 4);
    expect(s.median).toBe(0);
    expect(s.min).toBe(0);
    expect(s.max).toBe(255);
    expect(s.clippedShadows).toBeCloseTo(0.5);
    expect(s.clippedHighlights).toBeCloseTo(0.25);
    expect(rangeShare(h.r, 100, 255)).toBeCloseTo(0.5);
    expect(histStats(new Uint32Array(256)).pixels).toBe(0);
  });
});
