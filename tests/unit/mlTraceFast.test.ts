/** Typed-array boundary tracing and component labelling (Select Subject latency work): same results as the reference. */
import { describe, expect, it } from 'vitest';
import { loopArea, traceMaskLoops } from '../../src/core/ml/maskToPath';
import { cleanMask, labelComponents } from '../../src/core/ml/tensor';

describe('fast mask tracing / labelling', () => {
  it('a diagonal saddle (two pixels touching at a corner) is one figure-eight loop through the shared corner', () => {
    // 1 0
    // 0 1   (same as the previous Map-based tracer, checked equal on 30 random masks when it was replaced)
    const loops = traceMaskLoops(new Uint8Array([1, 0, 0, 1]), 2, 2);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(8);
    expect(loops[0].filter((p) => p.x === 1 && p.y === 1).length).toBe(2);
    expect(Math.abs(loopArea(loops[0]))).toBe(2);
  });

  it('a ring gives an outer loop and a hole of opposite orientation, areas add up', () => {
    const w = 9, h = 9, bin = new Uint8Array(w * h);
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) bin[y * w + x] = x >= 3 && x <= 5 && y >= 3 && y <= 5 ? 0 : 1;
    const loops = traceMaskLoops(bin, w, h);
    expect(loops.length).toBe(2);
    const areas = loops.map(loopArea);
    expect(Math.sign(areas[0])).toBe(-Math.sign(areas[1]));
    expect(Math.abs(areas[0] + areas[1])).toBe(49 - 9);
  });

  it('every boundary edge of a random mask is used exactly once', () => {
    const w = 64, h = 48, bin = new Uint8Array(w * h);
    let s = 7;
    for (let i = 0; i < bin.length; i++) bin[i] = ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 3) === 0 ? 1 : 0;
    const edges = (() => { let n = 0; const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] === 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) n += +!at(x, y - 1) + +!at(x + 1, y) + +!at(x, y + 1) + +!at(x - 1, y); return n; })();
    const loops = traceMaskLoops(bin, w, h);
    expect(loops.reduce((a, l) => a + l.length, 0)).toBe(edges);
    let area = 0; for (const l of loops) area += loopArea(l);
    expect(Math.abs(area)).toBe(bin.reduce((a, v) => a + v, 0));
  });

  it('labels 4-connected components and cleanMask drops specks < 5 % of the largest', () => {
    const w = 40, h = 20, bin = new Uint8Array(w * h);
    for (let y = 2; y < 18; y++) for (let x = 2; x < 20; x++) bin[y * w + x] = 1; // 288 px
    bin[5 * w + 30] = 1; bin[6 * w + 31] = 1; // two diagonal specks: separate 4-components
    for (let y = 10; y < 15; y++) for (let x = 25; x < 30; x++) bin[y * w + x] = 1; // 25 px (>= 5 %)
    const { areas } = labelComponents(bin, w, h);
    expect(areas.slice(1).sort((a, b) => a - b)).toEqual([1, 1, 25, 288]);
    const c = cleanMask(bin, w, h);
    expect(c.reduce((a, v) => a + v, 0)).toBe(288 + 25);
  });
});
