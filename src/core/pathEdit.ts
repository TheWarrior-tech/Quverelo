/**
 * Node-level path editing for the Pen and Node tools (Affinity Designer's node
 * tool): add a node on a segment without changing the curve, delete nodes,
 * convert sharp / smooth / symmetric, break at a node, join and close curves,
 * reverse direction, and find the nearest point on a path.
 *
 * Everything works on the editable `Subpath[]` form from core/path.ts and is
 * pure: inputs are never mutated.
 */
import type { Anchor, Subpath } from './path';
import type { Point } from './geometry';
import type { PathCommand } from './types';

export type NodeKind = 'sharp' | 'smooth' | 'symmetric';

export interface NodeRef {
  sub: number;
  anchor: number;
}

const clone = (subs: Subpath[]): Subpath[] => subs.map((s) => ({ closed: s.closed, anchors: s.anchors.map((a) => ({ ...a })) }));

/** Number of segments in a subpath (closed paths have one more). */
export function segmentCount(s: Subpath): number {
  return s.closed ? s.anchors.length : Math.max(0, s.anchors.length - 1);
}

/** The cubic control points of segment `i` (anchor i → anchor i+1). Straight segments get handles on their anchors. */
export function segmentPoints(s: Subpath, i: number): [Point, Point, Point, Point] {
  const a = s.anchors[i];
  const b = s.anchors[(i + 1) % s.anchors.length];
  return [
    { x: a.x, y: a.y },
    { x: a.outX ?? a.x, y: a.outY ?? a.y },
    { x: b.inX ?? b.x, y: b.inY ?? b.y },
    { x: b.x, y: b.y },
  ];
}

export function isStraight(s: Subpath, i: number): boolean {
  const a = s.anchors[i];
  const b = s.anchors[(i + 1) % s.anchors.length];
  return a.outX === null && b.inX === null;
}

export function bezierAt(p: [Point, Point, Point, Point], t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p[0].x + 3 * mt * mt * t * p[1].x + 3 * mt * t * t * p[2].x + t ** 3 * p[3].x,
    y: mt ** 3 * p[0].y + 3 * mt * mt * t * p[1].y + 3 * mt * t * t * p[2].y + t ** 3 * p[3].y,
  };
}

/** De Casteljau split of a cubic at t: [left, right]. */
export function splitCubic(p: [Point, Point, Point, Point], t: number): [[Point, Point, Point, Point], [Point, Point, Point, Point]] {
  const lerp = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(p[0], p[1]);
  const p12 = lerp(p[1], p[2]);
  const p23 = lerp(p[2], p[3]);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const m = lerp(p012, p123);
  return [[p[0], p01, p012, m], [m, p123, p23, p[3]]];
}

export interface PathHit {
  sub: number;
  segment: number;
  t: number;
  point: Point;
  distance: number;
}

/** Nearest point on any segment of the path to `p` (null when there are no segments). */
export function nearestOnPath(subs: Subpath[], p: Point, samples = 48): PathHit | null {
  let best: PathHit | null = null;
  subs.forEach((s, si) => {
    const n = segmentCount(s);
    for (let i = 0; i < n; i++) {
      const pts = segmentPoints(s, i);
      // coarse sampling then refinement
      let bt = 0;
      let bd = Infinity;
      for (let k = 0; k <= samples; k++) {
        const t = k / samples;
        const q = bezierAt(pts, t);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) {
          bd = d;
          bt = t;
        }
      }
      let lo = Math.max(0, bt - 1 / samples);
      let hi = Math.min(1, bt + 1 / samples);
      for (let it = 0; it < 24; it++) {
        const t1 = lo + (hi - lo) / 3;
        const t2 = hi - (hi - lo) / 3;
        const q1 = bezierAt(pts, t1);
        const q2 = bezierAt(pts, t2);
        if (Math.hypot(q1.x - p.x, q1.y - p.y) < Math.hypot(q2.x - p.x, q2.y - p.y)) hi = t2;
        else lo = t1;
      }
      const t = (lo + hi) / 2;
      const q = bezierAt(pts, t);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || d < best.distance) best = { sub: si, segment: i, t, point: q, distance: d };
    }
  });
  return best;
}

/** Add a node at parameter t of a segment; the curve's shape is unchanged. */
export function insertNode(subs: Subpath[], sub: number, segment: number, t: number): { subs: Subpath[]; ref: NodeRef } {
  const out = clone(subs);
  const s = out[sub];
  const ia = segment;
  const ib = (segment + 1) % s.anchors.length;
  const a = s.anchors[ia];
  const b = s.anchors[ib];
  let node: Anchor;
  if (a.outX === null && b.inX === null) {
    node = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, inX: null, inY: null, outX: null, outY: null };
  } else {
    const [l, r] = splitCubic(segmentPoints(s, segment), t);
    a.outX = l[1].x;
    a.outY = l[1].y;
    b.inX = r[2].x;
    b.inY = r[2].y;
    node = { x: l[3].x, y: l[3].y, inX: l[2].x, inY: l[2].y, outX: r[1].x, outY: r[1].y };
  }
  s.anchors.splice(ia + 1, 0, node);
  return { subs: out, ref: { sub, anchor: ia + 1 } };
}

/** Delete nodes. A subpath left with fewer than 2 nodes (1 for open) is removed. */
export function deleteNodes(subs: Subpath[], refs: NodeRef[]): Subpath[] {
  const out = clone(subs);
  const bySub = new Map<number, Set<number>>();
  for (const r of refs) {
    if (!bySub.has(r.sub)) bySub.set(r.sub, new Set());
    bySub.get(r.sub)!.add(r.anchor);
  }
  return out
    .map((s, si) => {
      const del = bySub.get(si);
      if (!del) return s;
      return { ...s, anchors: s.anchors.filter((_, i) => !del.has(i)) };
    })
    .filter((s) => s.anchors.length >= 2)
    .map((s) => (s.closed && s.anchors.length < 3 ? { ...s, closed: false } : s));
}

/** The current kind of a node. */
export function nodeKind(a: Anchor): NodeKind {
  if (a.inX === null || a.outX === null) return a.inX === null && a.outX === null ? 'sharp' : 'sharp';
  const v1 = { x: a.inX - a.x, y: a.inY! - a.y };
  const v2 = { x: a.outX - a.x, y: a.outY! - a.y };
  const l1 = Math.hypot(v1.x, v1.y);
  const l2 = Math.hypot(v2.x, v2.y);
  if (!l1 || !l2) return 'sharp';
  const cross = (v1.x * v2.y - v1.y * v2.x) / (l1 * l2);
  const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
  if (Math.abs(cross) > 0.01 || dot > -0.99) return 'sharp';
  return Math.abs(l1 - l2) < 0.01 * Math.max(l1, l2) ? 'symmetric' : 'smooth';
}

/**
 * Convert nodes: sharp removes both handles (straight corners); smooth and
 * symmetric give handles tangent to the neighbours (keeping existing handle
 * directions when there are any; symmetric also equalises their lengths).
 */
export function setNodeKind(subs: Subpath[], refs: NodeRef[], kind: NodeKind): Subpath[] {
  const out = clone(subs);
  for (const r of refs) {
    const s = out[r.sub];
    const a = s?.anchors[r.anchor];
    if (!a) continue;
    if (kind === 'sharp') {
      a.inX = a.inY = a.outX = a.outY = null;
      continue;
    }
    const n = s.anchors.length;
    const hasPrev = s.closed || r.anchor > 0;
    const hasNext = s.closed || r.anchor < n - 1;
    const prev = hasPrev ? s.anchors[(r.anchor - 1 + n) % n] : null;
    const next = hasNext ? s.anchors[(r.anchor + 1) % n] : null;
    // tangent direction: existing handles first, else neighbour chord
    let dx: number;
    let dy: number;
    if (a.outX !== null && a.inX !== null) {
      dx = a.outX - a.inX;
      dy = a.outY! - a.inY!;
    } else if (a.outX !== null) {
      dx = a.outX - a.x;
      dy = a.outY! - a.y;
    } else if (a.inX !== null) {
      dx = a.x - a.inX;
      dy = a.y - a.inY!;
    } else {
      const p = prev ?? a;
      const q = next ?? a;
      dx = q.x - p.x;
      dy = q.y - p.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const dPrev = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 0;
    const dNext = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
    let lin = a.inX !== null ? Math.hypot(a.inX - a.x, a.inY! - a.y) : dPrev;
    let lout = a.outX !== null ? Math.hypot(a.outX - a.x, a.outY! - a.y) : dNext;
    if (!lin) lin = lout;
    if (!lout) lout = lin;
    if (kind === 'symmetric') lin = lout = (lin + lout) / 2;
    if (prev || kind === 'symmetric') {
      a.inX = a.x - ux * lin;
      a.inY = a.y - uy * lin;
    }
    if (next || kind === 'symmetric') {
      a.outX = a.x + ux * lout;
      a.outY = a.y + uy * lout;
    }
  }
  return out;
}

/**
 * Break the path at a node. A closed subpath opens there (the node is
 * duplicated so both ends sit on it); an open subpath splits in two.
 */
export function breakAt(subs: Subpath[], ref: NodeRef): Subpath[] {
  const out = clone(subs);
  const s = out[ref.sub];
  if (!s) return out;
  const a = s.anchors;
  if (s.closed) {
    const rot = [...a.slice(ref.anchor), ...a.slice(0, ref.anchor)];
    const first = { ...rot[0], inX: null, inY: null };
    const last = { ...rot[0], outX: null, outY: null };
    out[ref.sub] = { closed: false, anchors: [first, ...rot.slice(1), last] };
    return out;
  }
  if (ref.anchor <= 0 || ref.anchor >= a.length - 1) return out;
  const left = a.slice(0, ref.anchor + 1).map((x) => ({ ...x }));
  const right = a.slice(ref.anchor).map((x) => ({ ...x }));
  left[left.length - 1].outX = left[left.length - 1].outY = null;
  right[0].inX = right[0].inY = null;
  out.splice(ref.sub, 1, { closed: false, anchors: left }, { closed: false, anchors: right });
  return out;
}

/** Close an open subpath (joins its last node back to its first). Coincident ends merge. */
export function closeSubpath(subs: Subpath[], sub: number): Subpath[] {
  const out = clone(subs);
  const s = out[sub];
  if (!s || s.closed || s.anchors.length < 2) return out;
  const first = s.anchors[0];
  const last = s.anchors[s.anchors.length - 1];
  if (s.anchors.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
    first.inX = last.inX;
    first.inY = last.inY;
    s.anchors.pop();
  }
  s.closed = true;
  return out;
}

export function reverseSubpath(s: Subpath): Subpath {
  return {
    closed: s.closed,
    anchors: [...s.anchors].reverse().map((a) => ({ x: a.x, y: a.y, inX: a.outX, inY: a.outY, outX: a.inX, outY: a.inY })),
  };
}

export function reversePath(subs: Subpath[]): Subpath[] {
  return subs.map(reverseSubpath);
}

/**
 * Join two end nodes of open subpaths with a segment (or merge them when they
 * coincide). Joining the two ends of one subpath closes it.
 */
export function joinEnds(subs: Subpath[], a: NodeRef, b: NodeRef): Subpath[] {
  const sa = subs[a.sub];
  const sb = subs[b.sub];
  if (!sa || !sb || sa.closed || sb.closed) return clone(subs);
  const isEnd = (s: Subpath, i: number) => i === 0 || i === s.anchors.length - 1;
  if (!isEnd(sa, a.anchor) || !isEnd(sb, b.anchor)) return clone(subs);
  if (a.sub === b.sub) return a.anchor === b.anchor ? clone(subs) : closeSubpath(subs, a.sub);
  // orient: A must end at the joined node, B must start at it
  const A = a.anchor === 0 ? reverseSubpath(sa) : { closed: false, anchors: sa.anchors.map((x) => ({ ...x })) };
  const B = b.anchor === 0 ? { closed: false, anchors: sb.anchors.map((x) => ({ ...x })) } : reverseSubpath(sb);
  const end = A.anchors[A.anchors.length - 1];
  const start = B.anchors[0];
  let anchors: Anchor[];
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) {
    anchors = [...A.anchors.slice(0, -1), { ...end, outX: start.outX, outY: start.outY }, ...B.anchors.slice(1)];
  } else anchors = [...A.anchors, ...B.anchors];
  const joined: Subpath = { closed: false, anchors };
  const out = clone(subs).filter((_, i) => i !== a.sub && i !== b.sub);
  out.splice(Math.min(a.sub, b.sub), 0, joined);
  return out;
}

/**
 * Join every pair of open curves whose end nodes are the selected ones (Node
 * tool ▸ Join curves). With exactly two selected ends, those are joined; with
 * none selected, the nearest pair of open ends across the whole path is.
 */
export function joinSelected(subs: Subpath[], refs: NodeRef[]): Subpath[] {
  const isEnd = (r: NodeRef) => {
    const s = subs[r.sub];
    return !!s && !s.closed && (r.anchor === 0 || r.anchor === s.anchors.length - 1);
  };
  const ends = refs.filter(isEnd);
  if (ends.length === 2) return joinEnds(subs, ends[0], ends[1]);
  if (ends.length === 1 && subs[ends[0].sub].anchors.length > 2) return closeSubpath(subs, ends[0].sub);
  // nearest pair of open ends
  const all: NodeRef[] = [];
  subs.forEach((s, si) => {
    if (s.closed || s.anchors.length < 1) return;
    all.push({ sub: si, anchor: 0 });
    if (s.anchors.length > 1) all.push({ sub: si, anchor: s.anchors.length - 1 });
  });
  let best: [NodeRef, NodeRef] | null = null;
  let bd = Infinity;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].sub === all[j].sub) continue;
      const p = subs[all[i].sub].anchors[all[i].anchor];
      const q = subs[all[j].sub].anchors[all[j].anchor];
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bd) {
        bd = d;
        best = [all[i], all[j]];
      }
    }
  }
  if (best) return joinEnds(subs, best[0], best[1]);
  // a single open subpath: close it
  const open = subs.findIndex((s) => !s.closed && s.anchors.length > 2);
  return open >= 0 ? closeSubpath(subs, open) : clone(subs);
}

/** Move handles so the node's kind is preserved while dragging one handle. */
export function dragHandle(a: Anchor, part: 'in' | 'out', p: Point, kind: NodeKind | 'free'): Anchor {
  const out = { ...a };
  const other = part === 'out' ? 'in' : 'out';
  if (part === 'out') {
    out.outX = p.x;
    out.outY = p.y;
  } else {
    out.inX = p.x;
    out.inY = p.y;
  }
  const ox = other === 'in' ? out.inX : out.outX;
  const oy = other === 'in' ? out.inY : out.outY;
  if (kind === 'sharp' || kind === 'free' || ox === null || oy === null) return out;
  const len = kind === 'symmetric' ? Math.hypot(p.x - a.x, p.y - a.y) : Math.hypot(ox - a.x, oy - a.y);
  const ang = Math.atan2(p.y - a.y, p.x - a.x) + Math.PI;
  const nx = a.x + Math.cos(ang) * len;
  const ny = a.y + Math.sin(ang) * len;
  if (other === 'in') {
    out.inX = nx;
    out.inY = ny;
  } else {
    out.outX = nx;
    out.outY = ny;
  }
  return out;
}

/** Move nodes (with their handles) by dx, dy. */
export function moveNodes(subs: Subpath[], refs: NodeRef[], dx: number, dy: number): Subpath[] {
  const out = clone(subs);
  for (const r of refs) {
    const a = out[r.sub]?.anchors[r.anchor];
    if (!a) continue;
    a.x += dx;
    a.y += dy;
    if (a.inX !== null) {
      a.inX += dx;
      a.inY! += dy;
    }
    if (a.outX !== null) {
      a.outX += dx;
      a.outY! += dy;
    }
  }
  return out;
}

/** Nodes inside a rectangle (marquee selection). */
export function nodesInRect(subs: Subpath[], r: { x: number; y: number; w: number; h: number }): NodeRef[] {
  const out: NodeRef[] = [];
  subs.forEach((s, si) => s.anchors.forEach((a, ai) => {
    if (a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h) out.push({ sub: si, anchor: ai });
  }));
  return out;
}

/** Bend a segment by dragging a point on it at t to p (Affinity's curve drag). */
export function bendSegment(subs: Subpath[], sub: number, segment: number, t: number, p: Point): Subpath[] {
  const out = clone(subs);
  const s = out[sub];
  const pts = segmentPoints(s, segment);
  const cur = bezierAt(pts, t);
  const dx = p.x - cur.x;
  const dy = p.y - cur.y;
  // distribute the move between the two control points by their weight at t
  const w1 = 3 * (1 - t) * (1 - t) * t;
  const w2 = 3 * (1 - t) * t * t;
  const denom = w1 * w1 + w2 * w2 || 1;
  const k1 = w1 / denom;
  const k2 = w2 / denom;
  const a = s.anchors[segment];
  const b = s.anchors[(segment + 1) % s.anchors.length];
  a.outX = pts[1].x + dx * k1;
  a.outY = pts[1].y + dy * k1;
  b.inX = pts[2].x + dx * k2;
  b.inY = pts[2].y + dy * k2;
  return out;
}

// ---------------------------------------------------------------------------
// Pen rubber band

/** Snap the vector from `o` to `p` to the nearest 45°. */
export function snap45(o: Point, p: Point): Point {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: o.x + Math.cos(ang) * len, y: o.y + Math.sin(ang) * len };
}

export interface PenPreview {
  /** the segment a click at the pointer would add, from the last node: ['M', …] then ['L' | 'C', …] */
  d: PathCommand[];
  /** a click here closes the curve on its first node */
  closing: boolean;
  /** where the next node would land (Shift-snapped, or the first node when closing) */
  target: Point;
}

/**
 * The rubber band the pen draws between clicks: exactly the segment the next
 * click would commit, so the last node's outgoing handle bends it the way the
 * finished curve will bend (a cubic, not an approximation).
 */
export function penPreview(anchors: Anchor[], mouse: Point, opts: { shift?: boolean; closeRadius: number }): PenPreview | null {
  const last = anchors[anchors.length - 1];
  if (!last) return null;
  const first = anchors[0];
  const closing = anchors.length > 2 && Math.hypot(mouse.x - first.x, mouse.y - first.y) < opts.closeRadius;
  const target = closing ? { x: first.x, y: first.y } : opts.shift ? snap45(last, mouse) : { x: mouse.x, y: mouse.y };
  const inX = closing ? first.inX : null;
  const inY = closing ? first.inY : null;
  const d: PathCommand[] = [['M', last.x, last.y]];
  if (last.outX === null && inX === null) d.push(['L', target.x, target.y]);
  else d.push(['C', last.outX ?? last.x, last.outY ?? last.y, inX ?? target.x, inY ?? target.y, target.x, target.y]);
  return { d, closing, target };
}
