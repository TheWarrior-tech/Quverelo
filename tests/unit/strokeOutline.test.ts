import { describe, expect, it } from 'vitest';
import { createDocument, make, makeStroke } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { pointInPath, rectPath } from '../../src/core/path';
import { dashPolylines, strokeOutline } from '../../src/core/strokeOutline';
import { expandNode, needsExpansion } from '../../src/core/vectorExpand';
import { pageToSvg } from '../../src/core/svg';
import type { GroupNode, Stroke } from '../../src/core/types';

const st = (patch: Partial<Stroke> = {}): Stroke => ({ ...makeStroke('#000000', 10), ...patch });
const conical = { type: 'conical' as const, angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };

describe('stroke outline', () => {
  it('covers a straight stroke exactly, butt caps', () => {
    const o = strokeOutline([['M', 0, 0], ['L', 100, 0]], st());
    expect(pointInPath(o, { x: 50, y: 4 })).toBe(true);
    expect(pointInPath(o, { x: 50, y: -4 })).toBe(true);
    expect(pointInPath(o, { x: 50, y: 6 })).toBe(false);
    expect(pointInPath(o, { x: -3, y: 0 })).toBe(false);
  });
  it('round and square caps reach past the end by half the width', () => {
    expect(pointInPath(strokeOutline([['M', 0, 0], ['L', 100, 0]], st({ cap: 'round' })), { x: 104, y: 0 })).toBe(true);
    expect(pointInPath(strokeOutline([['M', 0, 0], ['L', 100, 0]], st({ cap: 'round' })), { x: 104, y: 4 })).toBe(false);
    expect(pointInPath(strokeOutline([['M', 0, 0], ['L', 100, 0]], st({ cap: 'square' })), { x: 104, y: 4 })).toBe(true);
  });
  it('a closed rect stroke is a ring with mitred corners', () => {
    const o = strokeOutline([...rectPath(100, 100), ['Z']] as never, st({ join: 'miter' }));
    expect(pointInPath(o, { x: 0, y: -50 })).toBe(true); // on the edge
    expect(pointInPath(o, { x: 0, y: 0 })).toBe(false); // the hole
    expect(pointInPath(o, { x: -54, y: -54 })).toBe(true); // mitred corner
    const bevel = strokeOutline([...rectPath(100, 100), ['Z']] as never, st({ join: 'bevel' }));
    expect(pointInPath(bevel, { x: -54, y: -54 })).toBe(false);
  });
  it('splits dashes along the path, honouring the offset', () => {
    const pieces = dashPolylines([{ pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }], [10, 10]);
    expect(pieces).toHaveLength(5);
    expect(pieces[1].pts[0].x).toBeCloseTo(20);
    const shifted = dashPolylines([{ pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false }], [10, 10], 5);
    expect(shifted[0].pts[1].x).toBeCloseTo(5);
    const o = strokeOutline([['M', 0, 0], ['L', 100, 0]], st({ dash: [10, 10] }));
    expect(pointInPath(o, { x: 5, y: 0 })).toBe(true);
    expect(pointInPath(o, { x: 15, y: 0 })).toBe(false);
  });
});

describe('conical gradient on strokes', () => {
  const ring = make.ellipse({ x: 100, y: 100, w: 120, h: 120, fill: { type: 'none' }, stroke: { ...st({ width: 16 }), paint: conical } });
  it('expands to wedges clipped to the stroke for SVG / PDF; the canvas paints it natively', () => {
    expect(needsExpansion(ring)).toBe(false);
    expect(needsExpansion(ring, { conicalWedges: true })).toBe(true);
    const e = expandNode(ring, { conicalWedges: true }) as GroupNode;
    const clip = e.children.find((c) => c.name === 'stroke-conical') as GroupNode;
    expect(clip.children).toHaveLength(180);
    expect(clip.mask?.enabled).toBe(true);
    expect(pointInPath(clip.mask!.d, { x: 60, y: 0 })).toBe(true); // on the ring
    expect(pointInPath(clip.mask!.d, { x: 0, y: 0 })).toBe(false); // centre stays clear
  });
  it('SVG: no linear stand-in any more, the wedges and their clip are written', () => {
    let d = createDocument({ settings: { width: 300, height: 300 } });
    d = addNodes(d, d.pages[0].id, [ring]);
    const svg = pageToSvg(d, d.pages[0]);
    expect(svg).not.toContain('<linearGradient');
    expect(svg).toMatch(/<clipPath id="clip\d+">/);
    expect((svg.match(/fill="#[0-9a-f]{6}" stroke="none"/g) ?? []).length).toBeGreaterThanOrEqual(180);
  });
});
