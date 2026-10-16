import { describe, expect, it } from 'vitest';
import { ellipsePath, pathToSubpaths, subpathsToPath, flattenPath, type Subpath } from '../../src/core/path';
import {
  bendSegment, breakAt, closeSubpath, deleteNodes, dragHandle, insertNode, joinEnds, joinSelected, moveNodes, nearestOnPath,
  nodeKind, nodesInRect, reversePath, segmentCount, setNodeKind, splitCubic, bezierAt,
} from '../../src/core/pathEdit';

const square = (): Subpath[] => pathToSubpaths([['M', 0, 0], ['L', 100, 0], ['L', 100, 100], ['L', 0, 100], ['Z']]);
const openLine = (): Subpath[] => pathToSubpaths([['M', 0, 0], ['L', 50, 0], ['L', 100, 0]]);

function maxDeviation(a: Subpath[], b: Subpath[]): number {
  // every point of a lies on b (exact nearest-point search)
  let worst = 0;
  for (const p of flattenPath(subpathsToPath(a), 32).flat()) worst = Math.max(worst, nearestOnPath(b, p)!.distance);
  return worst;
}

describe('path editing (node tool)', () => {
  it('splits a cubic exactly at t', () => {
    const p = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }] as [any, any, any, any];
    const [l, r] = splitCubic(p, 0.3);
    const m = bezierAt(p, 0.3);
    expect(l[3].x).toBeCloseTo(m.x);
    expect(r[0].y).toBeCloseTo(m.y);
    expect(bezierAt(l, 0.5).x).toBeCloseTo(bezierAt(p, 0.15).x, 6);
    expect(bezierAt(r, 0.5).y).toBeCloseTo(bezierAt(p, 0.65).y, 6);
  });

  it('adds a node on a curve without changing its shape', () => {
    const subs = pathToSubpaths(ellipsePath(200, 100));
    const hit = nearestOnPath(subs, { x: 70, y: -40 })!;
    expect(hit.distance).toBeLessThan(10);
    const { subs: out, ref } = insertNode(subs, hit.sub, hit.segment, hit.t);
    expect(out[0].anchors).toHaveLength(subs[0].anchors.length + 1);
    expect(out[0].anchors[ref.anchor].x).toBeCloseTo(hit.point.x, 6);
    expect(maxDeviation(out, subs)).toBeLessThan(0.01);
    expect(maxDeviation(subs, out)).toBeLessThan(0.01);
    expect(nodeKind(out[0].anchors[ref.anchor])).toBe('smooth');
    // input not mutated
    expect(subs[0].anchors).toHaveLength(4);
  });

  it('adds a node on a straight segment', () => {
    const { subs, ref } = insertNode(square(), 0, 0, 0.25);
    expect(subs[0].anchors[ref.anchor]).toMatchObject({ x: 25, y: 0, inX: null, outX: null });
    expect(segmentCount(subs[0])).toBe(5);
  });

  it('deletes nodes and drops subpaths that become too small', () => {
    const out = deleteNodes(square(), [{ sub: 0, anchor: 1 }]);
    expect(out[0].anchors).toHaveLength(3);
    expect(out[0].closed).toBe(true);
    const gone = deleteNodes(openLine(), [{ sub: 0, anchor: 0 }, { sub: 0, anchor: 1 }]);
    expect(gone).toHaveLength(0);
  });

  it('converts nodes between sharp, smooth and symmetric', () => {
    const smooth = setNodeKind(square(), [{ sub: 0, anchor: 1 }], 'smooth');
    const a = smooth[0].anchors[1];
    expect(a.inX).not.toBeNull();
    expect(a.outX).not.toBeNull();
    expect(nodeKind(a)).not.toBe('sharp');
    const sym = setNodeKind(smooth, [{ sub: 0, anchor: 1 }], 'symmetric');
    expect(nodeKind(sym[0].anchors[1])).toBe('symmetric');
    const sharp = setNodeKind(sym, [{ sub: 0, anchor: 1 }], 'sharp');
    expect(sharp[0].anchors[1]).toMatchObject({ inX: null, inY: null, outX: null, outY: null });
  });

  it('keeps handles collinear (smooth) or mirrored (symmetric) while dragging one', () => {
    const a = { x: 0, y: 0, inX: -10, inY: 0, outX: 30, outY: 0 };
    const s = dragHandle(a, 'out', { x: 0, y: 20 }, 'smooth');
    expect(s.inX).toBeCloseTo(0);
    expect(s.inY).toBeCloseTo(-10); // length kept
    const m = dragHandle(a, 'out', { x: 0, y: 20 }, 'symmetric');
    expect(m.inY).toBeCloseTo(-20);
    const f = dragHandle(a, 'out', { x: 0, y: 20 }, 'sharp');
    expect(f.inX).toBe(-10);
  });

  it('breaks a closed path open at a node and splits an open path in two', () => {
    const open = breakAt(square(), { sub: 0, anchor: 2 });
    expect(open[0].closed).toBe(false);
    expect(open[0].anchors).toHaveLength(5);
    expect(open[0].anchors[0]).toMatchObject({ x: 100, y: 100 });
    expect(open[0].anchors[4]).toMatchObject({ x: 100, y: 100 });
    const two = breakAt(openLine(), { sub: 0, anchor: 1 });
    expect(two).toHaveLength(2);
    expect(two[0].anchors.map((a) => a.x)).toEqual([0, 50]);
    expect(two[1].anchors.map((a) => a.x)).toEqual([50, 100]);
  });

  it('joins curves end to end, merging coincident ends, and closes', () => {
    const a = pathToSubpaths([['M', 0, 0], ['L', 50, 0]])[0];
    const b = pathToSubpaths([['M', 100, 0], ['L', 50, 0]])[0];
    const joined = joinEnds([a, b], { sub: 0, anchor: 1 }, { sub: 1, anchor: 1 });
    expect(joined).toHaveLength(1);
    expect(joined[0].anchors.map((p) => p.x)).toEqual([0, 50, 100]);
    const c = pathToSubpaths([['M', 0, 0], ['L', 10, 0]])[0];
    const d = pathToSubpaths([['M', 20, 0], ['L', 30, 0]])[0];
    const auto = joinSelected([c, d], []);
    expect(auto).toHaveLength(1);
    expect(auto[0].anchors).toHaveLength(4);
    const closed = closeSubpath(openLine(), 0);
    expect(closed[0].closed).toBe(true);
    expect(joinSelected(openLine(), [{ sub: 0, anchor: 0 }, { sub: 0, anchor: 2 }])[0].closed).toBe(true);
  });

  it('reverses, moves, marquee-selects and bends', () => {
    const r = reversePath(openLine());
    expect(r[0].anchors.map((a) => a.x)).toEqual([100, 50, 0]);
    const m = moveNodes(openLine(), [{ sub: 0, anchor: 1 }], 0, 10);
    expect(m[0].anchors[1].y).toBe(10);
    expect(nodesInRect(square(), { x: 50, y: -10, w: 60, h: 120 })).toEqual([{ sub: 0, anchor: 1 }, { sub: 0, anchor: 2 }]);
    const bent = bendSegment(square(), 0, 0, 0.5, { x: 50, y: -30 });
    const p = bezierAt([{ x: 0, y: 0 }, { x: bent[0].anchors[0].outX!, y: bent[0].anchors[0].outY! }, { x: bent[0].anchors[1].inX!, y: bent[0].anchors[1].inY! }, { x: 100, y: 0 }], 0.5);
    expect(p.y).toBeCloseTo(-30, 4);
  });
});
