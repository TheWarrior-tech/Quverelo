import { describe, expect, it } from 'vitest';
import { createDocument, make, makeStroke, solid, findNode, nodeToPath } from '../../src/core/document';
import { addNodes, convertToCurves, distributeCentres, matchSize, spaceNodes } from '../../src/core/commands';
import { colorAt, conicalWedges, gradientGeometry, gradientHandles, insertStop, linearDefault, rampPosition, setGradientHandles } from '../../src/core/gradient';
import { arrowize, hasProfile, profileAt, strokeFx, trimSubpath, variableWidthOutline, WIDTH_PROFILES, profileId } from '../../src/core/strokeFx';
import { layoutTextOnPath, glyphBounds } from '../../src/core/textPath';
import { expandNode, needsExpansion } from '../../src/core/vectorExpand';
import { pathToSubpaths, pointInPath, pathBounds } from '../../src/core/path';
import { createSymbol, insertInstance, syncSymbols, symbolInstances, detachInstances, contentKey } from '../../src/core/symbols';
import { addSlice, plannedFiles, sliceFileName, sliceRect, slicesFromArtboards, pruneSlices, removeSlice } from '../../src/core/slices';
import { addArtboard, artboardAt, moveIntoArtboard, nextArtboardName, setArtboardSize } from '../../src/core/artboards';
import { migrateDocument } from '../../src/core/migrate';
import type { GroupNode, PathNode, Stroke } from '../../src/core/types';

const box = { x: -50, y: -25, w: 100, h: 50 };

describe('gradients', () => {
  it('keeps the angle-only linear geometry of earlier files', () => {
    const g = gradientGeometry({ type: 'linear', angle: 0, stops: [] }, box);
    expect(g).toEqual({ type: 'linear', x1: -50, y1: 0, x2: 50, y2: 0 });
    const d = linearDefault(90);
    expect(d.from.y).toBeCloseTo(0);
    expect(d.to.y).toBeCloseTo(1);
  });

  it('round-trips on-canvas handles for linear, radial and conical', () => {
    const stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }];
    for (const type of ['linear', 'radial', 'conical'] as const) {
      const p = type === 'radial' ? { type, stops } : { type, stops, angle: 0 };
      const moved = setGradientHandles(p as never, box, { x: -20, y: -5 }, { x: 30, y: 15 });
      const h = gradientHandles(moved, box);
      expect(h.start.x).toBeCloseTo(-20);
      expect(h.start.y).toBeCloseTo(-5);
      if (type === 'linear') expect(h.end).toMatchObject({ x: expect.closeTo(30), y: expect.closeTo(15) });
    }
    const rad = setGradientHandles({ type: 'radial', stops }, box, { x: 0, y: 0 }, { x: 20, y: 0 });
    expect(gradientGeometry(rad, box)).toMatchObject({ type: 'radial', cx: 0, cy: 0, r: expect.closeTo(20) });
    // the geometry follows the object when it is resized
    const big = { x: -100, y: -50, w: 200, h: 100 };
    expect(gradientHandles(rad, big).start.x).toBeCloseTo(0);
  });

  it('projects points on the ramp and inserts stops in the existing colour', () => {
    const p = { type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] };
    expect(rampPosition(p, box, { x: 0, y: 10 })).toBeCloseTo(0.5);
    const { paint, index } = insertStop(p, 0.5);
    expect(paint.stops).toHaveLength(3);
    expect(paint.stops[index].color).toBe('#808080');
    expect(colorAt([{ offset: 0, color: 'rgba(255,0,0,0)' }, { offset: 1, color: '#ff0000' }], 0.5)).toBe('rgba(255,0,0,0.5)');
    const c = { type: 'conical' as const, angle: 0, stops: p.stops };
    expect(rampPosition(c, box, { x: 0, y: 10 })).toBeCloseTo(0.25);
  });

  it('turns a conical gradient into covering wedges', () => {
    const w = conicalWedges({ type: 'conical', angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }, box, 36);
    expect(w).toHaveLength(36);
    expect(w[0].color).toBe('#040404');
    expect(w[35].color).toBe('#fbfbfb');
    // wedges reach beyond every corner
    const far = Math.max(...w.flatMap((x) => x.points.map(([px, py]) => Math.hypot(px, py))));
    expect(far).toBeGreaterThan(Math.hypot(50, 25));
  });
});

describe('strokes', () => {
  const stroke: Stroke = { ...makeStroke('#000000', 4), endArrow: 'triangle', startArrow: 'circle' };
  it('adds arrowheads at the ends of open paths and trims the line under them', () => {
    const { line, heads } = arrowize([['M', 0, 0], ['L', 100, 0]], stroke);
    expect(heads).toHaveLength(2);
    expect(heads[1].mode).toBe('fill');
    // triangle tip at the end point
    expect(heads[1].d[0]).toEqual(['M', 100, 0]);
    const sub = pathToSubpaths(line)[0];
    expect(sub.anchors[1].x).toBeLessThan(100);
    expect(sub.anchors[0].x).toBeGreaterThan(0);
    // closed paths get none
    expect(arrowize([['M', 0, 0], ['L', 10, 0], ['L', 10, 10], ['Z']], stroke).heads).toHaveLength(0);
  });

  it('trims curved ends along the curve', () => {
    const sub = pathToSubpaths([['M', 0, 0], ['C', 0, 50, 100, 50, 100, 0]])[0];
    const t = trimSubpath(sub, 0, 10);
    expect(Math.hypot(t.anchors[1].x - 100, t.anchors[1].y)).toBeGreaterThan(8);
    expect(Math.hypot(t.anchors[1].x - 100, t.anchors[1].y)).toBeLessThan(12);
  });

  it('builds a variable-width outline from a profile', () => {
    expect(profileAt([{ t: 0, w: 0 }, { t: 1, w: 1 }], 0.5)).toBeCloseTo(0.5);
    const s: Stroke = { ...makeStroke('#000000', 20), profile: WIDTH_PROFILES.find((p) => p.id === 'taper-both')!.profile };
    expect(hasProfile(s)).toBe(true);
    expect(profileId(s.profile)).toBe('taper-both');
    const out = variableWidthOutline([['M', 0, 0], ['L', 200, 0]], s);
    const b = pathBounds(out);
    expect(b.h).toBeCloseTo(20, 0);
    expect(pointInPath(out, { x: 100, y: 8 })).toBe(true);
    expect(pointInPath(out, { x: 5, y: 8 })).toBe(false); // tapered
    const fx = strokeFx([['M', 0, 0], ['L', 200, 0]], { ...s, endArrow: 'open' });
    expect(fx.line).toBeNull();
    expect(fx.outline).not.toBeNull();
    expect(fx.heads[0].mode).toBe('stroke');
  });
});

describe('text on path', () => {
  const adv = () => 10;
  it('places glyphs along the path by arc length and reports overflow', () => {
    const r = layoutTextOnPath('abc', [['M', 0, 0], ['L', 100, 0]], 0, adv);
    expect(r.glyphs.map((g) => g.x)).toEqual([0, 10, 20]);
    expect(r.glyphs.every((g) => g.angle === 0)).toBe(true);
    const half = layoutTextOnPath('abc', [['M', 0, 0], ['L', 100, 0]], 0.5, adv);
    expect(half.glyphs[0].x).toBeCloseTo(50);
    const over = layoutTextOnPath('abcdefghijkl', [['M', 0, 0], ['L', 100, 0]], 0, adv);
    expect(over.overflow).toBe(true);
    expect(over.glyphs).toHaveLength(10);
  });
  it('turns glyphs with the curve and flips to the other side', () => {
    const r = layoutTextOnPath('ab', [['M', 0, 0], ['L', 0, 100]], 0, adv);
    expect(r.glyphs[0].angle).toBeCloseTo(Math.PI / 2);
    const f = layoutTextOnPath('ab', [['M', 0, 0], ['L', 100, 0]], 0, adv, true);
    expect(f.glyphs[0].angle).toBeCloseTo(Math.PI);
    expect(f.glyphs[0].x).toBeCloseTo(100);
    expect(glyphBounds(r.glyphs, 8, 2)!.h).toBeCloseTo(20);
  });
});

describe('non-destructive compounds and expansion', () => {
  const docWith = () => {
    const a = make.rect({ x: 0, y: 0, w: 100, h: 100, fill: solid('#ff0000') });
    const b = make.ellipse({ x: 50, y: 0, w: 60, h: 60 });
    const g: GroupNode = { ...make.group([a, b]), compound: { op: 'subtract', fill: solid('#00ff00'), stroke: makeStroke() } };
    let d = createDocument({ settings: { width: 300, height: 300 } });
    d = addNodes(d, d.pages[0].id, [g]);
    return { d, g, a, b };
  };
  it('computes the live boolean of its children', () => {
    const { g } = docWith();
    const d = nodeToPath(g)!;
    expect(pointInPath(d, { x: -30, y: 0 })).toBe(true);
    expect(pointInPath(d, { x: 45, y: 0 })).toBe(false); // cut away
    for (const op of ['add', 'intersect', 'exclude'] as const) {
      const p = nodeToPath({ ...g, children: [...g.children], compound: { ...g.compound!, op } })!;
      expect(p.length).toBeGreaterThan(0);
    }
    expect(pointInPath(nodeToPath({ ...g, children: [...g.children], compound: { ...g.compound!, op: 'intersect' } })!, { x: 45, y: 0 })).toBe(true);
  });
  it('expands to a path with the compound style, and bakes on Expand', () => {
    const { d, g } = docWith();
    const e = expandNode(g) as PathNode;
    expect(e.type).toBe('path');
    expect(e.fill).toEqual(solid('#00ff00'));
    expect(e.x).toBe(g.x);
    const baked = convertToCurves(d, g.id);
    const n = findNode(baked, g.id)!.node as PathNode;
    expect(n.type).toBe('path');
    expect(n.fill).toEqual(solid('#00ff00'));
  });
  it('expands artboards to a clipped group with their background and conical fills to wedges', () => {
    const ab: GroupNode = { ...make.group([make.rect({ x: 0, y: 0 })]), artboard: { w: 200, h: 100, background: '#ffffff' } };
    const e = expandNode(ab) as GroupNode;
    expect(e.mask?.enabled).toBe(true);
    expect(pathBounds(e.mask!.d)).toMatchObject({ w: 200, h: 100 });
    expect(e.children).toHaveLength(2);
    const r = make.rect({ fill: { type: 'conical', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] } });
    expect(needsExpansion(r)).toBe(false);
    expect(needsExpansion(r, { conicalWedges: true })).toBe(true);
    const w = expandNode(r, { conicalWedges: true }) as GroupNode;
    expect((w.children[0] as GroupNode).children.length).toBe(180);
  });
});

describe('symbols', () => {
  it('updates every instance when one is edited', () => {
    let d = createDocument({ settings: { width: 500, height: 500 } });
    const r = make.rect({ x: 50, y: 50, fill: solid('#ff0000') });
    d = addNodes(d, d.pages[0].id, [r]);
    const s = createSymbol(d, [r.id], 'Button');
    d = s.doc;
    expect(d.symbols).toHaveLength(1);
    d = insertInstance(d, s.symbolId!, d.pages[0].id, 300, 300).doc;
    let inst = symbolInstances(d).get(s.symbolId!)!;
    expect(inst).toHaveLength(2);
    expect(inst[1].x).toBe(300);
    // edit the child of the second instance
    const child = inst[1].children[0];
    const prev = d;
    const edited = { ...d, pages: d.pages.map((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === inst[1].id ? { ...n, children: [{ ...child, fill: solid('#0000ff') }] } as GroupNode : n)) })) };
    d = syncSymbols(prev, edited);
    inst = symbolInstances(d).get(s.symbolId!)!;
    expect(inst.map((g) => (g.children[0] as { fill: unknown }).fill)).toEqual([solid('#0000ff'), solid('#0000ff')]);
    expect(inst[0].children[0].id).not.toBe(inst[1].children[0].id);
    expect(contentKey(inst[0].children[0].id)).toBe(contentKey(inst[1].children[0].id));
    expect(inst[0].x).not.toBe(inst[1].x); // transforms stay per instance
    expect(d.symbols![0].nodes[0]).toMatchObject({ fill: solid('#0000ff') });
    // unrelated edits are left alone
    expect(syncSymbols(d, d)).toBe(d);
    // detached instances no longer follow
    d = detachInstances(d, [inst[0].id]);
    expect(symbolInstances(d).get(s.symbolId!)).toHaveLength(1);
    // survives save/load
    expect(migrateDocument(JSON.parse(JSON.stringify(d))).symbols![0].name).toBe('Button');
  });
});

describe('artboards and slices', () => {
  it('adds artboards, finds them and moves objects in', () => {
    let d = createDocument({ settings: { width: 2000, height: 2000 } });
    const pid = d.pages[0].id;
    const a = addArtboard(d, pid, { x: 0, y: 0, w: 400, h: 300 });
    d = a.doc;
    expect(nextArtboardName(d, pid)).toBe('Artboard 2');
    const b = addArtboard(d, pid, { x: 500, y: 0, w: 200, h: 200 });
    d = b.doc;
    expect(artboardAt(d, pid, { x: 600, y: 100 })?.id).toBe(b.id);
    expect(artboardAt(d, pid, { x: 450, y: 100 })).toBeNull();
    const r = make.rect({ x: 600, y: 100 });
    d = addNodes(d, pid, [r]);
    d = moveIntoArtboard(d, r.id, b.id);
    const ab = findNode(d, b.id)!.node as GroupNode;
    expect(ab.children[0]).toMatchObject({ id: r.id, x: 0, y: 0 });
    d = setArtboardSize(d, b.id, 250, 100);
    expect((findNode(d, b.id)!.node as GroupNode).artboard).toMatchObject({ w: 250, h: 100 });
  });

  it('names slice files per output and follows the artboard', () => {
    let d = createDocument({ settings: { width: 2000, height: 2000 } });
    const pid = d.pages[0].id;
    const a = addArtboard(d, pid, { x: 100, y: 50, w: 400, h: 300 }, 'Home');
    d = slicesFromArtboards(a.doc, pid);
    expect(d.slices).toHaveLength(1);
    expect(slicesFromArtboards(d, pid).slices).toHaveLength(1);
    const s = d.slices![0];
    expect(sliceRect(d, s)).toEqual({ x: 100, y: 50, w: 400, h: 300 });
    expect(sliceFileName(s, { format: 'png', scale: 2 })).toBe('Home@2x.png');
    expect(sliceFileName(s, { format: 'svg', scale: 2 })).toBe('Home.svg');
    d = addSlice(d, { name: 'Home', pageId: pid, rect: { x: 0, y: 0, w: 10, h: 10 }, outputs: [{ format: 'png', scale: 1 }, { format: 'png', scale: 1 }] }).doc;
    const files = plannedFiles(d.slices!).map((f) => f.file);
    expect(files).toEqual(['Home.png', 'Home@2x.png', 'Home (2).png']);
    expect(sliceFileName({ name: 'a/b:c' }, { format: 'jpg', scale: 1 })).toBe('a-b-c.jpg');
    d = removeSlice(d, d.slices![1].id);
    expect(d.slices).toHaveLength(1);
    const gone = { ...d, pages: d.pages.map((p) => ({ ...p, nodes: [] })) };
    expect(pruneSlices(gone).slices).toHaveLength(0);
  });
});

describe('align and spacing', () => {
  it('spaces with a fixed gap, distributes centres and matches size', () => {
    let d = createDocument({ settings: { width: 1000, height: 1000 } });
    const a = make.rect({ x: 50, y: 50, w: 100, h: 20 });
    const b = make.rect({ x: 400, y: 50, w: 50, h: 20 });
    const c = make.rect({ x: 900, y: 50, w: 10, h: 20 });
    d = addNodes(d, d.pages[0].id, [a, b, c]);
    const s = spaceNodes(d, [a.id, b.id, c.id], 'h', 10);
    expect(findNode(s, b.id)!.node.x).toBe(135); // a 0..100, gap 10, b 110..160
    expect(findNode(s, c.id)!.node.x).toBe(175); // c 170..180
    const dc = distributeCentres(d, [a.id, b.id, c.id], 'h');
    expect(findNode(dc, b.id)!.node.x).toBe(475);
    const m = matchSize(d, [a.id, b.id], a.id, 'both');
    expect(findNode(m, b.id)!.node).toMatchObject({ w: 100, h: 20 });
  });
});
