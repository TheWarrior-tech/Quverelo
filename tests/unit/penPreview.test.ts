import { describe, expect, it } from 'vitest';
import { subpathsToPath, type Anchor } from '../../src/core/path';
import { penPreview, snap45 } from '../../src/core/pathEdit';

const A = (x: number, y: number, out?: [number, number], inn?: [number, number]): Anchor => ({
  x, y, inX: inn?.[0] ?? null, inY: inn?.[1] ?? null, outX: out?.[0] ?? null, outY: out?.[1] ?? null,
});

describe('pen rubber band', () => {
  it('is nothing before the first click', () => {
    expect(penPreview([], { x: 1, y: 1 }, { closeRadius: 8 })).toBeNull();
  });
  it('is a straight segment after a sharp node', () => {
    const p = penPreview([A(0, 0)], { x: 100, y: 20 }, { closeRadius: 8 })!;
    expect(p.d).toEqual([['M', 0, 0], ['L', 100, 20]]);
    expect(p.closing).toBe(false);
  });
  it('is the exact cubic the next click commits after a smooth node', () => {
    const anchors = [A(0, 0), A(100, 0, [150, -50], [50, 50])];
    const mouse = { x: 300, y: 0 };
    const p = penPreview(anchors, mouse, { closeRadius: 8 })!;
    expect(p.d).toEqual([['M', 100, 0], ['C', 150, -50, 300, 0, 300, 0]]);
    // the same segment subpathsToPath produces once the click lands
    const committed = subpathsToPath([{ anchors: [...anchors, A(300, 0)], closed: false }]);
    expect(committed[committed.length - 1]).toEqual(p.d[1]);
  });
  it('snaps to 45° with Shift, like the click does', () => {
    const p = penPreview([A(0, 0)], { x: 100, y: 90 }, { shift: true, closeRadius: 8 })!;
    expect(p.target.x).toBeCloseTo(snap45({ x: 0, y: 0 }, { x: 100, y: 90 }).x);
    expect(p.target.x).toBeCloseTo(p.target.y);
  });
  it('previews the closing segment on the first node, using its incoming handle', () => {
    const anchors = [A(0, 0, undefined, [-30, 30]), A(100, 0), A(100, 100)];
    const p = penPreview(anchors, { x: 3, y: -2 }, { closeRadius: 8 })!;
    expect(p.closing).toBe(true);
    expect(p.target).toEqual({ x: 0, y: 0 });
    expect(p.d[1]).toEqual(['C', 100, 100, -30, 30, 0, 0]);
    // two nodes can't close yet
    expect(penPreview(anchors.slice(0, 2), { x: 3, y: -2 }, { closeRadius: 8 })!.closing).toBe(false);
  });
});
