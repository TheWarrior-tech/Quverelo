import { describe, expect, it } from 'vitest';
import { hairline, sceneLine } from '../../src/renderer/engine/hairline';

/** device-pixel extent [start, end) of a stroke of width w centred at c, at scale d */
const extent = (c: number, w: number, d: number) => [(c - w / 2) * d, (c + w / 2) * d];
const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

describe('hairline (canvas chrome on whole device pixels)', () => {
  it('is the old Math.round(v) + 0.5 / lineWidth 1 at 100 %', () => {
    const h = hairline(1);
    expect(h.width).toBe(1);
    for (const v of [0, 10.2, 10.5, 10.7, 333.49]) expect(h.line(v)).toBe(Math.round(v) + 0.5);
    expect(h.stroke(7)).toBe(7);
  });

  for (const d of [1.25, 1.5, 1.75, 2, 3]) {
    it(`puts both edges of a hairline on device pixel edges at ${d * 100} %`, () => {
      const h = hairline(d);
      expect(h.device).toBe(Math.floor(d));
      for (const v of [0, 3.3, 10.5, 47.75, 512.2]) {
        const [a, b] = extent(h.line(v), h.width, d);
        expect(whole(a) && whole(b)).toBe(true);
        expect(b - a).toBeCloseTo(h.device, 9);
        expect(Math.abs(h.line(v) - v)).toBeLessThanOrEqual(1 / d + 1e-9); // at most one device px away
      }
      // thicker strokes and handle squares centred on a hairline stay crisp too
      for (const w of [3, 5, 7]) {
        const [a, b] = extent(h.line(20.3), h.stroke(w), d);
        expect(whole(a) && whole(b)).toBe(true);
      }
      expect(whole(h.edge(12.34) * d)).toBe(true);
      expect(whole(h.size(3) * d)).toBe(true);
    });
  }

  it('snaps scene-space lines through the viewport transform', () => {
    const h = hairline(1.5);
    const z = 0.6;
    const off = 87.3;
    const x = sceneLine(h, 210, z, off);
    const [a, b] = extent(x * z + off, h.width, 1.5);
    expect(whole(a) && whole(b)).toBe(true);
    expect(Math.abs(x - 210) * z).toBeLessThanOrEqual(1 / 1.5 + 1e-9);
  });
});
