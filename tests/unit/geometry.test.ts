import { describe, expect, it } from 'vitest';
import { apply, composeTransform, decompose, invert, multiply, transformRect } from '../../src/core/geometry';

describe('geometry', () => {
  it('composes and decomposes transforms', () => {
    const t = { x: 10, y: 20, rotation: 30, scaleX: 2, scaleY: 0.5, skewX: 0, flipX: false, flipY: false };
    const d = decompose(composeTransform(t));
    expect(d.x).toBeCloseTo(10);
    expect(d.y).toBeCloseTo(20);
    expect(d.rotation).toBeCloseTo(30);
    expect(d.scaleX).toBeCloseTo(2);
    expect(d.scaleY).toBeCloseTo(0.5);
  });
  it('inverts matrices', () => {
    const m = composeTransform({ x: 5, y: -3, rotation: 45, scaleX: 3, scaleY: 2, skewX: 10, flipX: true, flipY: false });
    const p = apply(multiply(m, invert(m)), { x: 7, y: 9 });
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(9);
  });
  it('computes transformed bounds', () => {
    const r = transformRect(composeTransform({ x: 0, y: 0, rotation: 90, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false }), { x: -10, y: -5, w: 20, h: 10 });
    expect(r.w).toBeCloseTo(10);
    expect(r.h).toBeCloseTo(20);
  });
});
