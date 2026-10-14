import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENTS, applyAdjustment, applyAdjustments, blackWhite, brightnessContrast, createPixels, curveLut, floodMask,
  gaussianBlur, histogram, hslToRgb, hueSaturation, invertColors, levels, posterize, rgbToHsl,
} from '../../src/core/pixels';

const px = (r: number, g: number, b: number, a = 255, w = 4, h = 4) => createPixels(w, h, [r, g, b, a]);

describe('pixel ops', () => {
  it('brightness raises values', () => {
    expect(brightnessContrast(px(100, 100, 100), 50, 0).data[0]).toBeGreaterThan(100);
  });
  it('inverts', () => {
    expect(Array.from(invertColors(px(10, 20, 30)).data.slice(0, 4))).toEqual([245, 235, 225, 255]);
  });
  it('black and white equalises channels', () => {
    const d = blackWhite(px(200, 50, 10)).data;
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
  });
  it('levels maps black/white points', () => {
    const d = levels(px(50, 128, 200), 50, 200, 1).data;
    expect(d[0]).toBe(0);
    expect(d[2]).toBe(255);
  });
  it('identity curve is identity', () => {
    const lut = curveLut([{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }]);
    for (let i = 0; i < 256; i += 17) expect(Math.abs(lut[i] - i)).toBeLessThanOrEqual(1);
  });
  it('hsl round trips', () => {
    const [h, s, l] = rgbToHsl(200, 100, 50);
    const [r, g, b] = hslToRgb(h, s, l);
    expect(Math.round(r)).toBe(200);
    expect(Math.round(g)).toBe(100);
    expect(Math.round(b)).toBe(50);
  });
  it('hue rotation by 120 moves red to green', () => {
    const d = hueSaturation(px(255, 0, 0), 120, 0, 0).data;
    expect(d[1]).toBeGreaterThan(200);
    expect(d[0]).toBeLessThan(50);
  });
  it('blur keeps flat images flat and preserves alpha', () => {
    const d = gaussianBlur(px(80, 90, 100, 255, 16, 16), 4).data;
    expect(Math.round(d[0])).toBe(80);
    expect(d[3]).toBe(255);
  });
  it('posterize limits values', () => {
    const d = posterize(px(100, 100, 100), 2).data;
    expect([0, 255]).toContain(d[0]);
  });
  it('every adjustment runs with defaults', () => {
    const src = px(120, 60, 200, 255, 8, 8);
    for (const a of ADJUSTMENTS) {
      const out = applyAdjustment(src, { type: a.type, params: {} });
      expect(out.data.length).toBe(src.data.length);
    }
  });
  it('disabled adjustments are skipped', () => {
    const src = px(10, 10, 10);
    const out = applyAdjustments(src, [{ id: 'a', type: 'invert', enabled: false, params: {} }]);
    expect(out.data[0]).toBe(10);
  });
  it('histogram counts pixels', () => {
    const h = histogram(px(0, 0, 0, 255, 2, 2));
    expect(h.r[0]).toBe(4);
  });
  it('flood mask selects contiguous region', () => {
    const p = createPixels(3, 1, [0, 0, 0, 255]);
    p.data.set([255, 255, 255, 255], 4);
    const m = floodMask(p, 0, 0, 10);
    expect(Array.from(m)).toEqual([1, 0, 0]);
    expect(Array.from(floodMask(p, 0, 0, 10, false))).toEqual([1, 0, 1]);
  });
});
