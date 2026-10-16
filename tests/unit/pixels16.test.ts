import { describe, expect, it } from 'vitest';
import { applyAdjustment, applyAdjustments, ADJUSTMENTS, createPixels, defaultParams, type Pixels } from '../../src/core/pixels';
import {
  applyAdjustment16, applyAdjustments16, createPixels16, distinctLevels, merge16, resize16, stackIs16Bit, to16, to8, type Pixels16,
} from '../../src/core/pixels16';
import type { Adjustment, AdjustmentType } from '../../src/core/types';

/** A smooth 16-bit horizontal gradient over a narrow tonal range (the case 8 bits band on). */
function gradient16(w: number, h: number, lo = 0.3, hi = 0.4): Pixels16 {
  const p = createPixels16(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round((lo + ((hi - lo) * x) / (w - 1)) * 65535);
      const i = (y * w + x) * 4;
      p.data[i] = v;
      p.data[i + 1] = Math.round(v * 0.8);
      p.data[i + 2] = Math.round(v * 0.6);
      p.data[i + 3] = 65535;
    }
  return p;
}

const adj = (type: AdjustmentType, params: Record<string, number> = {}): Adjustment => ({ id: type, type, enabled: true, params: { ...defaultParams(type), ...params } });

describe('pixels16: conversion', () => {
  it('to16/to8 round-trip every 8-bit value exactly', () => {
    const p = createPixels(256, 1);
    for (let i = 0; i < 256; i++) p.data.set([i, 255 - i, i, 255], i * 4);
    const back = to8(to16(p));
    expect(Array.from(back.data)).toEqual(Array.from(p.data));
    expect(to16(p).data[4 * 255]).toBe(65535);
  });
});

describe('pixels16: every adjustment matches its 8-bit counterpart', () => {
  // random 8-bit image widened to 16: the 16-bit result rounded to 8 should match the 8-bit result closely
  const src8: Pixels = createPixels(24, 16);
  let seed = 7;
  for (let i = 0; i < src8.data.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    src8.data[i] = i % 4 === 3 ? 255 : (seed >>> 16) & 255;
  }
  const settings: Partial<Record<AdjustmentType, Record<string, number>>> = {
    'brightness-contrast': { brightness: 20, contrast: 30 },
    levels: { inBlack: 20, inWhite: 230, gamma: 1.3 },
    'hue-saturation': { hue: 40, saturation: 30, lightness: -10 },
    exposure: { exposure: 0.7, gamma: 1.1 },
    posterize: { levels: 5 },
    threshold: { level: 128 },
    vibrance: { amount: 50 },
    temperature: { temperature: 30, tint: -20 },
    blur: { radius: 3 },
    sharpen: { amount: 120, radius: 1.5 },
    noise: { amount: 20 },
    vignette: { amount: 60 },
    'color-balance': { shadowsCR: 40, midtonesMG: -30, highlightsYB: 25, preserveLuminosity: 0 },
    'motion-blur': { angle: 30, distance: 6 },
    'reduce-noise': { strength: 60, radius: 2, detail: 10 },
  };
  for (const spec of ADJUSTMENTS) {
    it(`${spec.type}`, () => {
      const a = adj(spec.type, settings[spec.type]);
      if (spec.type === 'curves') a.curves = { rgb: [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }], r: [{ x: 0, y: 0 }, { x: 255, y: 230 }], g: [{ x: 0, y: 0 }, { x: 255, y: 255 }], b: [{ x: 0, y: 20 }, { x: 255, y: 255 }] };
      if (spec.type === 'gradient-map') a.stops = [{ offset: 0, color: '#102040' }, { offset: 0.5, color: '#c04020' }, { offset: 1, color: '#fff0c0' }];
      const r8 = applyAdjustment(src8, a);
      const r16 = to8(applyAdjustment16(to16(src8), a));
      let maxDiff = 0;
      let sumDiff = 0;
      for (let i = 0; i < r8.data.length; i++) {
        const d = Math.abs(r8.data[i] - r16.data[i]);
        maxDiff = Math.max(maxDiff, d);
        sumDiff += d;
      }
      // the 16-bit path skips the 8-bit LUT rounding, so values may differ by a level or two (threshold/posterize by a step at a boundary)
      const tol = spec.type === 'threshold' || spec.type === 'posterize' ? 255 : spec.type === 'sharpen' || spec.type === 'noise' ? 6 : 3;
      expect(maxDiff).toBeLessThanOrEqual(tol);
      expect(sumDiff / r8.data.length).toBeLessThan(1.5);
    });
  }
  it('every built-in adjustment has a native 16-bit path', () => {
    expect(stackIs16Bit(ADJUSTMENTS.map((s) => ({ type: s.type, enabled: true })))).toBe(true);
    expect(stackIs16Bit([{ type: 'made-up' as AdjustmentType, enabled: true }])).toBe(false);
  });
});

describe('pixels16: photo parity adjustments keep 16-bit precision', () => {
  it('colour balance with preserve luminosity matches 8-bit', () => {
    const p8 = to8(gradient16(64, 2, 0.1, 0.9));
    const a = adj('color-balance', { midtonesCR: 50, preserveLuminosity: 1 });
    const r8 = applyAdjustment(p8, a);
    const r16 = to8(applyAdjustment16(to16(p8), a));
    let max = 0;
    for (let i = 0; i < r8.data.length; i++) max = Math.max(max, Math.abs(r8.data[i] - r16.data[i]));
    expect(max).toBeLessThanOrEqual(3);
  });
  it('gradient map and colour balance keep more than 256 levels on a narrow 16-bit ramp', () => {
    const src = gradient16(2048, 1, 0.3, 0.4);
    const gm = adj('gradient-map');
    gm.stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }];
    expect(distinctLevels(applyAdjustment16(src, gm))).toBeGreaterThan(256);
    expect(distinctLevels(applyAdjustment16(src, adj('color-balance', { midtonesCR: 30, preserveLuminosity: 0 })))).toBeGreaterThan(256);
  });
  it('gradient map uses the stops, not the default ramp, at 16 bits', () => {
    const p = createPixels16(1, 1, [32768, 32768, 32768, 65535]);
    const gm = adj('gradient-map');
    gm.stops = [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#ff0000' }];
    const out = applyAdjustment16(p, gm);
    expect(Array.from(out.data.slice(0, 3))).toEqual([65535, 0, 0]);
  });
});

describe('pixels16: precision', () => {
  it('a strong stack on a narrow 16-bit gradient keeps thousands of levels (8-bit bands to a few dozen)', () => {
    const g = gradient16(4096, 2);
    const stack = [adj('levels', { inBlack: 76, inWhite: 102, gamma: 1 }), adj('curves'), adj('exposure', { exposure: 0.3 })];
    stack[1].curves = { rgb: [{ x: 0, y: 0 }, { x: 128, y: 150 }, { x: 255, y: 255 }], r: [{ x: 0, y: 0 }, { x: 255, y: 255 }], g: [{ x: 0, y: 0 }, { x: 255, y: 255 }], b: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const out16 = applyAdjustments16(g, stack);
    const out8 = applyAdjustments(to8(g), stack);
    expect(distinctLevels(out16, 0)).toBeGreaterThan(2000);
    const seen = new Set<number>();
    for (let i = 0; i < out8.data.length; i += 4) seen.add(out8.data[i]);
    expect(seen.size).toBeLessThan(40);
  });

  it('16-bit blur keeps alpha-weighted colour (no dark halo)', () => {
    const p = createPixels16(9, 9, [65535, 0, 0, 0]);
    p.data.set([65535, 0, 0, 65535], (4 * 9 + 4) * 4);
    const out = applyAdjustment16(p, adj('blur', { radius: 4 }));
    const i = (4 * 9 + 5) * 4;
    expect(out.data[i + 3]).toBeGreaterThan(0);
    expect(out.data[i]).toBeGreaterThan(65000);
  });

  it('an adjustment type without a 16-bit path (added to core/pixels.ts later) runs at 8 bits instead of failing', () => {
    const p = gradient16(8, 1);
    ADJUSTMENTS.push({ type: 'future' as AdjustmentType, label: 'Future', params: [] });
    try {
      const out = applyAdjustment16(p, { type: 'future' as AdjustmentType, params: {} });
      expect(out.width).toBe(8);
      expect(out.data[0]).toBe(Math.round(p.data[0] / 257) * 257);
    } finally {
      ADJUSTMENTS.pop();
    }
    expect(applyAdjustment16(p, { type: 'unknown' as AdjustmentType, params: {} })).toBe(p);
  });
});

describe('pixels16: edits and resampling', () => {
  it('merge16 keeps untouched 16-bit values and takes edited pixels', () => {
    const g = gradient16(16, 1);
    const edited = to8(g);
    edited.data.set([0, 0, 0, 255], 4 * 3);
    const m = merge16(g, edited)!;
    expect(m.data[0]).toBe(g.data[0]);
    expect(m.data[4 * 3]).toBe(0);
    expect(m.data[4 * 5 + 1]).toBe(g.data[4 * 5 + 1]);
    expect(merge16(g, createPixels(3, 3))).toBeNull();
  });
  it('resize16 averages', () => {
    const p = createPixels16(4, 1);
    [0, 65535, 0, 65535].forEach((v, i) => p.data.set([v, v, v, 65535], i * 4));
    const r = resize16(p, 2, 1);
    expect(r.width).toBe(2);
    expect(Math.abs(r.data[0] - 32768)).toBeLessThan(2);
  });
});
