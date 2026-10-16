/**
 * Stroke effects that no output format has natively, turned into plain
 * geometry so the canvas, SVG and PDF renderers draw them identically:
 *
 *  - arrowheads at the ends of open paths (triangle, open, circle, square, diamond, bar),
 *    with the line trimmed so it never pokes through the head;
 *  - variable-width strokes (a width profile along the path), drawn as a filled outline.
 */
import { flattenPath, pathToSubpaths, subpathsToPath, type Subpath } from './path';
import { segmentPoints, splitCubic, bezierAt } from './pathEdit';
import type { ArrowHead, PathCommand, Stroke, WidthPoint } from './types';
import type { Point } from './geometry';

export const ARROW_HEADS: ArrowHead[] = ['none', 'triangle', 'open', 'circle', 'square', 'diamond', 'bar'];

export function hasArrows(s: Stroke): boolean {
  return (!!s.startArrow && s.startArrow !== 'none') || (!!s.endArrow && s.endArrow !== 'none');
}

export function hasProfile(s: Stroke): boolean {
  return !!s.profile && s.profile.length >= 2 && s.profile.some((p) => Math.abs(p.w - 1) > 1e-6);
}

export function strokeVisible(s: Stroke): boolean {
  return s.width > 0 && s.paint.type !== 'none';
}

/** Geometry to draw for an arrowhead: filled with the stroke paint, or stroked at the stroke width. */
export interface ArrowGeometry {
  d: PathCommand[];
  mode: 'fill' | 'stroke';
}

/** Arrowhead size (length along the line) for a stroke. */
export function arrowSize(s: Stroke): number {
  return Math.max(4, s.width * 3) * (s.arrowScale ?? 1);
}

/** How far the line is pulled back from the end so it stops at the head's base. */
export function arrowInset(head: ArrowHead, s: Stroke): number {
  const L = arrowSize(s);
  switch (head) {
    case 'triangle': return L * 0.85;
    case 'open': return s.width * 0.5;
    case 'circle': return L * 0.4;
    case 'square': return L * 0.35;
    case 'diamond': return L * 0.5;
    default: return 0;
  }
}

/** Arrowhead outline with its tip at `tip`, pointing along `dir` (unit vector). */
export function arrowHeadPath(head: ArrowHead, tip: Point, dir: Point, s: Stroke): ArrowGeometry | null {
  if (head === 'none') return null;
  const L = arrowSize(s);
  const ux = dir.x;
  const uy = dir.y;
  // local frame: +u along the line towards the tip, +v to its left
  const P = (u: number, v: number): [number, number] => [tip.x + ux * u - uy * v, tip.y + uy * u + ux * v];
  const poly = (pts: [number, number][], closed = true): PathCommand[] => {
    const d: PathCommand[] = [['M', pts[0][0], pts[0][1]]];
    for (const p of pts.slice(1)) d.push(['L', p[0], p[1]]);
    if (closed) d.push(['Z']);
    return d;
  };
  switch (head) {
    case 'triangle':
      return { mode: 'fill', d: poly([P(0, 0), P(-L, L * 0.55), P(-L, -L * 0.55)]) };
    case 'open':
      return { mode: 'stroke', d: poly([P(-L, L * 0.55), P(0, 0), P(-L, -L * 0.55)], false) };
    case 'square': {
      const h = L * 0.35;
      return { mode: 'fill', d: poly([P(h, h), P(-h, h), P(-h, -h), P(h, -h)]) };
    }
    case 'diamond': {
      const h = L * 0.5;
      return { mode: 'fill', d: poly([P(h, 0), P(0, h * 0.8), P(-h, 0), P(0, -h * 0.8)]) };
    }
    case 'bar':
      return { mode: 'stroke', d: poly([P(0, L * 0.6), P(0, -L * 0.6)], false) };
    case 'circle': {
      const r = L * 0.4;
      const k = 0.5522847498307936 * r;
      const [cx, cy] = P(0, 0);
      return {
        mode: 'fill',
        d: [
          ['M', cx + r, cy],
          ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r],
          ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy],
          ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r],
          ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy],
          ['Z'],
        ],
      };
    }
  }
}

function unit(dx: number, dy: number): Point | null {
  const l = Math.hypot(dx, dy);
  return l > 1e-9 ? { x: dx / l, y: dy / l } : null;
}

/** Direction a subpath leaves its first node / arrives at its last node. */
function endDirections(s: Subpath): { start: Point | null; end: Point | null } {
  const a = s.anchors;
  if (a.length < 2) return { start: null, end: null };
  const first = segmentPoints(s, 0);
  const last = segmentPoints(s, a.length - 2);
  // the first control point that differs from the end gives the tangent
  const startDir = (() => {
    for (const q of [first[1], first[2], first[3]]) {
      const u = unit(first[0].x - q.x, first[0].y - q.y);
      if (u) return u;
    }
    return null;
  })();
  const endDir = (() => {
    for (const q of [last[2], last[1], last[0]]) {
      const u = unit(last[3].x - q.x, last[3].y - q.y);
      if (u) return u;
    }
    return null;
  })();
  return { start: startDir, end: endDir };
}

function cubicLength(p: [Point, Point, Point, Point], steps = 32): number {
  let len = 0;
  let prev = p[0];
  for (let i = 1; i <= steps; i++) {
    const q = bezierAt(p, i / steps);
    len += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return len;
}

/** t at which a cubic has travelled `dist` from its start. */
function tAtLength(p: [Point, Point, Point, Point], dist: number, steps = 64): number {
  let len = 0;
  let prev = p[0];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const q = bezierAt(p, t);
    const seg = Math.hypot(q.x - prev.x, q.y - prev.y);
    if (len + seg >= dist) return (i - 1) / steps + (seg ? (dist - len) / seg : 0) / steps;
    len += seg;
    prev = q;
  }
  return 1;
}

/** Shorten an open subpath by `a` at its start and `b` at its end (within its end segments). */
export function trimSubpath(s: Subpath, a: number, b: number): Subpath {
  if (s.closed || s.anchors.length < 2) return s;
  const anchors = s.anchors.map((x) => ({ ...x }));
  const out: Subpath = { closed: false, anchors };
  if (b > 0) {
    const i = anchors.length - 2;
    const pts = segmentPoints(out, i);
    const len = cubicLength(pts);
    const t = Math.max(0.0001, tAtLength(pts, Math.max(0, len - Math.min(b, len * 0.95))));
    const [l] = splitCubic(pts, t);
    const p = anchors[i];
    const q = anchors[i + 1];
    const straight = p.outX === null && q.inX === null;
    if (!straight) {
      p.outX = l[1].x;
      p.outY = l[1].y;
      q.inX = l[2].x;
      q.inY = l[2].y;
    }
    q.x = l[3].x;
    q.y = l[3].y;
  }
  if (a > 0) {
    const pts = segmentPoints(out, 0);
    const len = cubicLength(pts);
    const t = Math.min(0.9999, tAtLength(pts, Math.min(a, len * 0.95)));
    const [, r] = splitCubic(pts, t);
    const p = anchors[0];
    const q = anchors[1];
    const straight = p.outX === null && q.inX === null;
    if (!straight) {
      p.outX = r[1].x;
      p.outY = r[1].y;
      q.inX = r[2].x;
      q.inY = r[2].y;
    }
    p.x = r[0].x;
    p.y = r[0].y;
  }
  return out;
}

/**
 * Arrowheads for a path's open subpaths plus the path trimmed so the line stops
 * at each head's base. Closed subpaths get no arrows and are left as they are.
 */
export function arrowize(d: PathCommand[], s: Stroke): { line: PathCommand[]; heads: ArrowGeometry[] } {
  const start = s.startArrow ?? 'none';
  const end = s.endArrow ?? 'none';
  const subs = pathToSubpaths(d);
  const heads: ArrowGeometry[] = [];
  const trimmed = subs.map((sp) => {
    if (sp.closed || sp.anchors.length < 2) return sp;
    const dirs = endDirections(sp);
    const first = sp.anchors[0];
    const last = sp.anchors[sp.anchors.length - 1];
    if (start !== 'none' && dirs.start) {
      const h = arrowHeadPath(start, first, dirs.start, s);
      if (h) heads.push(h);
    }
    if (end !== 'none' && dirs.end) {
      const h = arrowHeadPath(end, last, dirs.end, s);
      if (h) heads.push(h);
    }
    return trimSubpath(sp, start !== 'none' ? arrowInset(start, s) : 0, end !== 'none' ? arrowInset(end, s) : 0);
  });
  return { line: subpathsToPath(trimmed), heads };
}

// ---------------------------------------------------------------------------
// variable width

/** Width multiplier of a profile at t (linear between points, held at the ends). */
export function profileAt(profile: WidthPoint[], t: number): number {
  if (!profile.length) return 1;
  const p = [...profile].sort((a, b) => a.t - b.t);
  if (t <= p[0].t) return p[0].w;
  if (t >= p[p.length - 1].t) return p[p.length - 1].w;
  for (let i = 0; i < p.length - 1; i++) {
    if (t >= p[i].t && t <= p[i + 1].t) {
      const k = p[i + 1].t - p[i].t ? (t - p[i].t) / (p[i + 1].t - p[i].t) : 0;
      // smoothstep between points so the outline has no kinks
      const sk = k * k * (3 - 2 * k);
      return p[i].w + (p[i + 1].w - p[i].w) * sk;
    }
  }
  return 1;
}

/** Preset width profiles offered in the stroke panel. */
export const WIDTH_PROFILES: { id: string; label: string; profile: WidthPoint[] }[] = [
  { id: 'uniform', label: 'Uniform', profile: [] },
  { id: 'taper-both', label: 'Taper both ends', profile: [{ t: 0, w: 0 }, { t: 0.5, w: 1 }, { t: 1, w: 0 }] },
  { id: 'taper-end', label: 'Taper end', profile: [{ t: 0, w: 1 }, { t: 1, w: 0 }] },
  { id: 'taper-start', label: 'Taper start', profile: [{ t: 0, w: 0 }, { t: 1, w: 1 }] },
  { id: 'swell', label: 'Swell', profile: [{ t: 0, w: 0.3 }, { t: 0.5, w: 1 }, { t: 1, w: 0.3 }] },
  { id: 'pinch', label: 'Pinch', profile: [{ t: 0, w: 1 }, { t: 0.5, w: 0.2 }, { t: 1, w: 1 }] },
  { id: 'brush', label: 'Brush', profile: [{ t: 0, w: 0.1 }, { t: 0.15, w: 1 }, { t: 0.7, w: 0.8 }, { t: 1, w: 0.05 }] },
];

export function profileId(profile: WidthPoint[] | undefined): string {
  if (!profile || profile.length < 2) return 'uniform';
  const hit = WIDTH_PROFILES.find((p) => p.profile.length === profile.length && p.profile.every((q, i) => Math.abs(q.t - profile[i].t) < 1e-6 && Math.abs(q.w - profile[i].w) < 1e-6));
  return hit?.id ?? 'custom';
}

// ---- custom profile editing (the inspector's width-profile graph) ----------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** A profile to edit: uniform (empty) becomes a flat two-point line, points sorted, ends pinned at t = 0 and 1. */
export function editableProfile(profile: WidthPoint[] | undefined): WidthPoint[] {
  const p = (profile && profile.length >= 2 ? [...profile] : [{ t: 0, w: 1 }, { t: 1, w: 1 }]).map((x) => ({ t: clamp01(x.t), w: clamp01(x.w) })).sort((a, b) => a.t - b.t);
  p[0] = { ...p[0], t: 0 };
  p[p.length - 1] = { ...p[p.length - 1], t: 1 };
  return p;
}

/** Add a point at t on the current curve (the stroke does not change shape); returns the profile and the new point's index. */
export function addProfilePoint(profile: WidthPoint[] | undefined, t: number): { profile: WidthPoint[]; index: number } {
  const p = editableProfile(profile);
  const tt = round3(clamp01(t));
  if (p.some((x) => Math.abs(x.t - tt) < 0.01)) return { profile: p, index: p.findIndex((x) => Math.abs(x.t - tt) < 0.01) };
  const pt = { t: tt, w: round3(profileAt(p, tt)) };
  const out = [...p, pt].sort((a, b) => a.t - b.t);
  return { profile: out, index: out.indexOf(pt) };
}

/** Move point i: width anywhere in 0..1; position between its neighbours (the two end points keep t = 0 / 1). */
export function moveProfilePoint(profile: WidthPoint[] | undefined, i: number, t: number, w: number): WidthPoint[] {
  const p = editableProfile(profile);
  if (i < 0 || i >= p.length) return p;
  const last = p.length - 1;
  const gap = 0.01;
  const nt = i === 0 ? 0 : i === last ? 1 : Math.min(p[i + 1].t - gap, Math.max(p[i - 1].t + gap, t));
  return p.map((x, j) => (j === i ? { t: round3(nt), w: round3(clamp01(w)) } : x));
}

/** Remove point i (never an end point, never below two points). */
export function removeProfilePoint(profile: WidthPoint[] | undefined, i: number): WidthPoint[] {
  const p = editableProfile(profile);
  if (i <= 0 || i >= p.length - 1) return p;
  return p.filter((_, j) => j !== i);
}

/**
 * Store a profile on a stroke: the bare two-point line at full width is
 * "uniform" (no profile); a flat line with points the user added is kept, so
 * a point just added on a uniform stroke stays there to be dragged.
 */
export function storedProfile(profile: WidthPoint[]): WidthPoint[] | undefined {
  return profile.length <= 2 && profile.every((x) => Math.abs(x.w - 1) < 1e-6) ? undefined : profile;
}

/** Resample a polyline at roughly `spacing` px intervals; returns points with their arc-length fraction. */
function resample(poly: Point[], spacing: number): { p: Point; t: number }[] {
  const lens = [0];
  for (let i = 1; i < poly.length; i++) lens.push(lens[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  const total = lens[lens.length - 1];
  if (total <= 0) return [];
  const n = Math.max(8, Math.min(600, Math.ceil(total / spacing)));
  const out: { p: Point; t: number }[] = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * total;
    while (j < lens.length - 1 && lens[j] < s) j++;
    const seg = lens[j] - lens[j - 1] || 1;
    const f = Math.min(1, Math.max(0, (s - lens[j - 1]) / seg));
    out.push({ p: { x: poly[j - 1].x + (poly[j].x - poly[j - 1].x) * f, y: poly[j - 1].y + (poly[j].y - poly[j - 1].y) * f }, t: s / total });
  }
  return out;
}

/**
 * Outline of a variable-width stroke as a fillable path (fill it non-zero with
 * the stroke paint). Open subpaths become one closed shape; closed subpaths
 * become an outer and an inner ring.
 */
export function variableWidthOutline(d: PathCommand[], s: Stroke): PathCommand[] {
  const profile = s.profile ?? [];
  const out: PathCommand[] = [];
  const subs = pathToSubpaths(d);
  const flats = flattenPath(d, 24);
  subs.forEach((sp, i) => {
    const poly = flats[i];
    if (!poly || poly.length < 2) return;
    const pts = resample(poly, 2);
    if (pts.length < 2) return;
    const left: Point[] = [];
    const right: Point[] = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)].p;
      const b = pts[Math.min(pts.length - 1, k + 1)].p;
      let nx = -(b.y - a.y);
      let ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const hw = (s.width * Math.max(0, profileAt(profile, pts[k].t))) / 2;
      left.push({ x: pts[k].p.x + nx * hw, y: pts[k].p.y + ny * hw });
      right.push({ x: pts[k].p.x - nx * hw, y: pts[k].p.y - ny * hw });
    }
    const ring = (list: Point[]) => {
      out.push(['M', list[0].x, list[0].y]);
      for (const p of list.slice(1)) out.push(['L', p.x, p.y]);
      out.push(['Z']);
    };
    if (sp.closed) {
      ring(left);
      ring(right.reverse());
    } else {
      // round-ish ends follow the cap
      ring([...left, ...right.reverse()]);
    }
  });
  return out;
}

/** Everything a stroke needs drawn beyond a plain stroke of `d`. */
export interface StrokeFxGeometry {
  /** path to stroke normally (trimmed for arrows); null when the stroke is drawn as a fill */
  line: PathCommand[] | null;
  /** filled outline of a variable-width stroke */
  outline: PathCommand[] | null;
  heads: ArrowGeometry[];
}

export function strokeFx(d: PathCommand[], s: Stroke): StrokeFxGeometry {
  let line: PathCommand[] = d;
  let heads: ArrowGeometry[] = [];
  if (hasArrows(s)) {
    const r = arrowize(d, s);
    line = r.line;
    heads = r.heads;
  }
  if (hasProfile(s)) return { line: null, outline: variableWidthOutline(line, s), heads };
  return { line, outline: null, heads };
}
