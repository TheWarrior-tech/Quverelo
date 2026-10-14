import { describe, expect, it } from 'vitest';
import {
  curvesLuts, curvesOf, defaultCurves, isIdentity, legacyCurves, monotoneCurve, normalizePoints, pointsToLut,
} from '../../src/core/curves';
import { applyAdjustment, createPixels, curves as legacyCurvesOp } from '../../src/core/pixels';

const sCurve = [{ x: 0, y: 0 }, { x: 64, y: 40 }, { x: 192, y: 220 }, { x: 255, y: 255 }];

describe('monotone cubic curve', () => {
  it('identity points give the identity LUT', () => {
    const lut = pointsToLut([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    expect(isIdentity(defaultCurves().rgb)).toBe(true);
  });

  it('passes exactly through every control point', () => {
    const f = monotoneCurve(sCurve);
    for (const p of sCurve) expect(f(p.x)).toBeCloseTo(p.y, 9);
  });

  it('never overshoots: a rising point list gives a non-decreasing LUT', () => {
    const steep = [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 110, y: 240 }, { x: 255, y: 255 }];
    for (const pts of [sCurve, steep]) {
      const lut = pointsToLut(pts);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
    // between two points the curve stays inside their y range
    const f = monotoneCurve(steep);
    for (let x = 100; x <= 110; x += 0.25) {
      expect(f(x)).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(f(x)).toBeLessThanOrEqual(240 + 1e-9);
    }
  });

  it('is flat at local extrema (no ringing around a peak)', () => {
    const f = monotoneCurve([{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 0 }]);
    for (let x = 0; x <= 255; x++) expect(f(x)).toBeLessThanOrEqual(200 + 1e-9);
  });

  it('clips outside the end points (black and white point)', () => {
    const lut = pointsToLut([{ x: 30, y: 0 }, { x: 220, y: 255 }]);
    expect(lut[0]).toBe(0);
    expect(lut[30]).toBe(0);
    expect(lut[220]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it('accepts unsorted, out-of-range and duplicate points', () => {
    expect(normalizePoints([{ x: 300, y: -5 }, { x: 10, y: 10 }, { x: 10, y: 20 }])).toEqual([{ x: 10, y: 20 }, { x: 255, y: 0 }]);
    const lut = pointsToLut([{ x: 255, y: 255 }, { x: 0, y: 0 }, { x: 128, y: 160 }]);
    expect(lut[128]).toBe(160);
  });

  it('handles degenerate inputs', () => {
    expect(monotoneCurve([])(77)).toBe(77);
    expect(monotoneCurve([{ x: 50, y: 99 }])(200)).toBe(99);
  });
});

describe('curves in the pixel pipeline', () => {
  it('applies channel curves then the composite curve', () => {
    const c = defaultCurves();
    c.r = [{ x: 0, y: 0 }, { x: 255, y: 128 }]; // halve red
    c.rgb = [{ x: 0, y: 255 }, { x: 255, y: 0 }]; // then invert everything
    const l = curvesLuts(c);
    expect(l.r[200]).toBe(255 - Math.round(200 * 128 / 255));
    expect(l.g[200]).toBe(55);
    const out = applyAdjustment(createPixels(1, 1, [200, 200, 200, 255]), { type: 'curves', params: {}, curves: c });
    expect(Array.from(out.data)).toEqual([l.r[200], 55, 55, 255]);
  });

  it('leaves alpha alone and is identity by default', () => {
    const src = createPixels(2, 1, [12, 130, 250, 77]);
    const out = applyAdjustment(src, { type: 'curves', params: {}, curves: defaultCurves() });
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('reads documents saved with the old three-offset Curves', () => {
    const params = { shadows: -30, midtones: 20, highlights: 10 };
    const old = legacyCurvesOp(createPixels(1, 1, [64, 128, 192, 255]), params.shadows, params.midtones, params.highlights);
    const now = applyAdjustment(createPixels(1, 1, [64, 128, 192, 255]), { type: 'curves', params });
    expect(Array.from(now.data)).toEqual(Array.from(old.data));
    expect(curvesOf({ params: {} })).toEqual(defaultCurves());
    expect(legacyCurves(params).rgb).toHaveLength(5);
  });
});
