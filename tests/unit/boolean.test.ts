import { describe, expect, it } from 'vitest';
import { booleanPaths } from '../../src/core/boolean';
import { pathBounds, rectPath, translatePath } from '../../src/core/path';

const a = rectPath(10, 10);
const b = translatePath(rectPath(10, 10), 5, 5);

describe('boolean ops', () => {
  it('adds', () => {
    const r = booleanPaths([a, b], 'add');
    expect(r).toHaveLength(1);
    const bb = pathBounds(r[0]);
    expect(bb.w).toBeCloseTo(15);
  });
  it('intersects', () => {
    const bb = pathBounds(booleanPaths([a, b], 'intersect')[0]);
    expect(bb.w).toBeCloseTo(5);
    expect(bb.x).toBeCloseTo(0);
  });
  it('subtracts', () => {
    const bb = pathBounds(booleanPaths([a, b], 'subtract')[0]);
    expect(bb.w).toBeCloseTo(10);
    expect(bb.x).toBeCloseTo(-5);
  });
  it('excludes and divides', () => {
    expect(booleanPaths([a, b], 'exclude')[0].length).toBeGreaterThan(4);
    expect(booleanPaths([a, b], 'divide').length).toBe(3);
  });
});
