import { describe, expect, it } from 'vitest';
import { centrePath, ellipsePath, parsePath, pathBounds, pathToString, pathToSubpaths, pointInPath, rectPath, starPoints, subpathsToPath } from '../../src/core/path';

describe('path', () => {
  it('parses relative, shorthand and arc commands', () => {
    const d = parsePath('m10 10 h20 v20 h-20 z M0 0 c 5 0 10 5 10 10 s 5 10 10 10 q 5 5 10 0 t 10 0 A 5 5 0 0 1 50 50');
    expect(d[0]).toEqual(['M', 10, 10]);
    expect(d[1]).toEqual(['L', 30, 10]);
    expect(d[3]).toEqual(['L', 10, 30]);
    expect(d[4]).toEqual(['Z']);
    expect(d.some((c) => c[0] === 'C')).toBe(true);
    expect(d.some((c) => c[0] === 'Q')).toBe(true);
    const last = d[d.length - 1];
    expect(last[0]).toBe('C');
    expect((last as number[]).slice(-2).map((v) => Math.round(v as number))).toEqual([50, 50]);
  });
  it('round-trips through string form', () => {
    const d = rectPath(100, 50, 10);
    expect(parsePath(pathToString(d)).length).toBe(d.length);
  });
  it('measures bounds of curves', () => {
    const b = pathBounds(ellipsePath(200, 100));
    expect(b.w).toBeCloseTo(200, 0);
    expect(b.h).toBeCloseTo(100, 0);
  });
  it('centres paths', () => {
    const c = centrePath([['M', 100, 100], ['L', 200, 100], ['L', 200, 150], ['Z']]);
    expect(c.cx).toBe(150);
    expect(c.cy).toBe(125);
    expect(pathBounds(c.d).x).toBe(-50);
  });
  it('hit-tests points', () => {
    expect(pointInPath(rectPath(10, 10), { x: 0, y: 0 })).toBe(true);
    expect(pointInPath(rectPath(10, 10), { x: 20, y: 0 })).toBe(false);
  });
  it('stars have 2n points', () => {
    expect(starPoints(100, 100, 5, 0.5)).toHaveLength(10);
  });
  it('converts to editable anchors and back', () => {
    const d = ellipsePath(100, 100);
    const subs = pathToSubpaths(d);
    expect(subs).toHaveLength(1);
    expect(subs[0].closed).toBe(true);
    expect(subs[0].anchors).toHaveLength(4);
    const back = subpathsToPath(subs);
    expect(pathBounds(back).w).toBeCloseTo(100, 0);
  });
});
