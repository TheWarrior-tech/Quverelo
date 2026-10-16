/**
 * Expansion of live vector features into plain nodes every renderer already
 * understands. The canvas, SVG and PDF writers call `expandNode` before they
 * draw a node, so compounds, arrowheads, variable-width strokes, artboards
 * and (for formats without one) conical gradients look the same everywhere.
 *
 * Expansion never changes the document; results are cached per node object.
 */
import { make, makeStroke, nodeToPath, NO_PAINT } from './document';
import { conicalWedges, type Box } from './gradient';
import { parsePath, rectPath } from './path';
import { hasArrows, hasProfile, strokeFx, strokeVisible } from './strokeFx';
import type { GroupNode, NodeBase, Paint, PathCommand, PathNode, SceneNode, Stroke } from './types';

export interface ExpandOptions {
  /** replace conical gradient fills by solid wedges (SVG / PDF) */
  conicalWedges?: boolean;
}

const IDENTITY: Pick<NodeBase, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'flipX' | 'flipY'> = {
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false,
};

type Shape = Extract<SceneNode, { type: 'rect' | 'ellipse' | 'polygon' | 'star' | 'path' }>;
const SHAPES = new Set(['rect', 'ellipse', 'polygon', 'star', 'path']);

const caches = [new WeakMap<SceneNode, SceneNode>(), new WeakMap<SceneNode, SceneNode>()];

/** Box used for gradient geometry of a shape (path: its control-point box; others: w × h). */
export function shapeBox(n: SceneNode, d?: PathCommand[] | null): Box {
  if (n.type !== 'path' && n.type !== 'group' && 'w' in n) return { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
  const path = d ?? nodeToPath(n) ?? [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of path) {
    for (let i = 1; i < c.length; i += 2) {
      const x = c[i] as number;
      const y = c[i + 1] as number;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Whether a node needs expansion before a renderer can draw it. */
export function needsExpansion(n: SceneNode, opts: ExpandOptions = {}): boolean {
  if (n.type === 'group') return !!n.compound || !!n.artboard;
  if (SHAPES.has(n.type)) {
    const s = n as Shape;
    if (strokeVisible(s.stroke) && (hasProfile(s.stroke) || (n.type === 'path' && hasArrows(s.stroke)))) return true;
    if (opts.conicalWedges && s.fill.type === 'conical') return true;
  }
  return false;
}

/** Expand one node (not its descendants: renderers recurse and expand those themselves). */
export function expandNode(n: SceneNode, opts: ExpandOptions = {}): SceneNode {
  if (!needsExpansion(n, opts)) return n;
  const cache = caches[opts.conicalWedges ? 1 : 0];
  const hit = cache.get(n);
  if (hit) return hit;
  const out = expandUncached(n, opts);
  cache.set(n, out);
  return out;
}

function baseOf(n: SceneNode): NodeBase {
  const { id, name, visible, locked, opacity, blend, x, y, rotation, scaleX, scaleY, skewX, flipX, flipY, mask } = n;
  return { id, name, visible, locked, opacity, blend, x, y, rotation, scaleX, scaleY, skewX, flipX, flipY, mask };
}

function expandUncached(n: SceneNode, opts: ExpandOptions): SceneNode {
  if (n.type === 'group' && n.compound) {
    const d = nodeToPath(n) ?? [];
    const p: PathNode = { ...baseOf(n), type: 'path', d, closed: true, fill: n.compound.fill, stroke: n.compound.stroke };
    return expandNode(p, opts);
  }
  if (n.type === 'group' && n.artboard) return expandArtboard(n);
  return expandShape(n as Shape, opts);
}

function expandArtboard(g: GroupNode): SceneNode {
  const a = g.artboard!;
  const bg = a.background
    ? [make.rect({ id: `${g.id}:board`, name: 'Board', w: a.w, h: a.h, x: 0, y: 0, radius: 0, fill: { type: 'solid', color: a.background }, stroke: makeStroke() })]
    : [];
  const clip = rectPath(a.w, a.h);
  // the board clips its content; a mask of its own (rare) is intersected by nesting
  const inner: GroupNode = { ...g, ...IDENTITY, id: `${g.id}:content`, opacity: 1, blend: 'normal', artboard: undefined, mask: { d: clip, inverted: false, enabled: true }, children: [...bg, ...g.children] };
  if (!g.mask) return { ...inner, ...pickTransform(g), opacity: g.opacity, blend: g.blend, id: g.id };
  return { ...baseOf(g), type: 'group', children: [inner] };
}

function pickTransform(n: SceneNode) {
  const { x, y, rotation, scaleX, scaleY, skewX, flipX, flipY } = n;
  return { x, y, rotation, scaleX, scaleY, skewX, flipX, flipY };
}

const pathChild = (id: string, d: PathCommand[], fill: Paint, stroke: Stroke, closed = true): PathNode => ({
  ...make.path({ id, name: 'part', d, closed, fill, stroke }),
  ...IDENTITY,
});

function expandShape(n: Shape, opts: ExpandOptions): SceneNode {
  const d = nodeToPath(n) ?? [];
  const box = shapeBox(n, d);
  const children: SceneNode[] = [];
  const s = n.stroke;
  const fill = n.type !== 'path' || n.closed || n.fill.type !== 'none' ? n.fill : NO_PAINT;
  // fill
  if (fill.type === 'conical' && opts.conicalWedges) {
    const wedges = conicalWedges(fill, box);
    const clip: GroupNode = {
      ...make.group(wedges.map((w, i) => pathChild(`${n.id}:w${i}`, parsePath(w.d), { type: 'solid', color: w.color }, makeStroke()))),
      ...IDENTITY, id: `${n.id}:fill`, mask: { d, inverted: false, enabled: true },
    };
    children.push(clip);
  } else if (fill.type !== 'none') {
    // same node type, so gradient geometry keeps the shape's own box
    children.push({ ...n, ...IDENTITY, id: `${n.id}:fill`, opacity: 1, blend: 'normal', mask: undefined, stroke: makeStroke() } as SceneNode);
  }
  // stroke
  if (strokeVisible(s)) {
    const fx = n.type === 'path' || hasProfile(s) ? strokeFx(d, n.type === 'path' ? s : { ...s, startArrow: 'none', endArrow: 'none' }) : { line: d, outline: null, heads: [] };
    const plain: Stroke = { ...s, startArrow: undefined, endArrow: undefined, profile: undefined };
    if (fx.outline) children.push({ ...pathChild(`${n.id}:outline`, fx.outline, s.paint, makeStroke()), name: 'stroke-outline' });
    if (fx.line) children.push(pathChild(`${n.id}:line`, fx.line, NO_PAINT, plain, false));
    fx.heads.forEach((h, i) => {
      children.push(h.mode === 'fill'
        ? pathChild(`${n.id}:head${i}`, h.d, s.paint, makeStroke())
        : pathChild(`${n.id}:head${i}`, h.d, NO_PAINT, { ...plain, dash: [], join: 'round', cap: s.cap === 'butt' ? 'round' : s.cap }, false));
    });
  }
  return { ...baseOf(n), type: 'group', name: n.name, children };
}

/** A path child produced by expansion that must be filled non-zero (variable-width outline). */
export function isNonZeroFill(n: SceneNode): boolean {
  return n.type === 'path' && n.name === 'stroke-outline';
}
