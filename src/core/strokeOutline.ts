/**
 * Outline of an ordinary stroke as fillable geometry: the area a renderer's
 * stroke would paint (width, dash pattern, caps and joins), so a paint that a
 * format can't put on a stroke (a conical gradient in SVG and PDF) can be
 * painted into it instead. Curves are flattened finely; each dash or subpath
 * becomes one ring (closed subpaths an outer and an inner ring), and the
 * rings are united so the result fills the same with even-odd or non-zero.
 */
import { booleanPaths } from './boolean';
import { flattenPath, pathToSubpaths } from './path';
import type { PathCommand, Stroke } from './types';
import type { Point } from './geometry';

interface Poly {
  pts: Point[];
  closed: boolean;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const len = (a: Point) => Math.hypot(a.x, a.y);
const unit = (a: Point): Point => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** left-hand normal of direction d */
const normal = (d: Point): Point => ({ x: -d.y, y: d.x });

/** Drop repeated points; a closed polyline loses its duplicated closing point. */
function clean(pts: Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (const p of pts) if (!out.length || len(sub(p, out[out.length - 1])) > 1e-6) out.push(p);
  if (closed && out.length > 2 && len(sub(out[0], out[out.length - 1])) < 1e-6) out.pop();
  return out;
}

/** Split polylines by a dash pattern (lengths in px, cycling; offset shifts the start). */
export function dashPolylines(polys: Poly[], dash: number[], offset = 0): Poly[] {
  const pattern = dash.length % 2 ? [...dash, ...dash] : dash;
  const total = pattern.reduce((a, b) => a + b, 0);
  if (!pattern.length || total <= 0) return polys;
  const out: Poly[] = [];
  for (const poly of polys) {
    const pts = poly.closed ? [...poly.pts, poly.pts[0]] : poly.pts;
    // position in the pattern at the start of this subpath
    let k = 0;
    let left = pattern[0];
    let skip = ((offset % total) + total) % total;
    while (skip > 0) {
      if (skip >= left) {
        skip -= left;
        k = (k + 1) % pattern.length;
        left = pattern[k];
      } else {
        left -= skip;
        skip = 0;
      }
    }
    let cur: Point[] | null = k % 2 === 0 ? [pts[0]] : null;
    for (let i = 1; i < pts.length; i++) {
      let a = pts[i - 1];
      const b = pts[i];
      let segLeft = len(sub(b, a));
      while (segLeft > 1e-9) {
        if (segLeft < left) {
          left -= segLeft;
          if (cur) cur.push(b);
          segLeft = 0;
        } else {
          const p = add(a, mul(unit(sub(b, a)), left));
          segLeft -= left;
          a = p;
          if (cur) {
            cur.push(p);
            if (cur.length > 1) out.push({ pts: cur, closed: false });
            cur = null;
          } else cur = [p];
          k = (k + 1) % pattern.length;
          left = pattern[k];
        }
      }
    }
    if (cur && cur.length > 1) out.push({ pts: cur, closed: false });
  }
  return out;
}

/** Points of an arc around c from angle a0 sweeping by `sweep` radians (excluding the start). */
function arc(c: Point, r: number, a0: number, sweep: number): Point[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
  const out: Point[] = [];
  for (let i = 1; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return out;
}

/** One side of a polyline offset by hw (positive: left), with the stroke's joins at corners. */
function offsetSide(pts: Point[], closed: boolean, hw: number, s: Stroke): Point[] {
  const n = pts.length;
  const out: Point[] = [];
  const limit = s.miter ?? 10;
  const dirAt = (i: number) => unit(sub(pts[(i + 1) % n], pts[i]));
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    const v = pts[i];
    if (!hasPrev) {
      out.push(add(v, mul(normal(dirAt(0)), hw)));
      continue;
    }
    const d0 = dirAt((i - 1 + n) % n);
    if (!hasNext) {
      out.push(add(v, mul(normal(d0), hw)));
      continue;
    }
    const d1 = dirAt(i);
    const n0 = normal(d0);
    const n1 = normal(d1);
    const cross = d0.x * d1.y - d0.y * d1.x;
    const outer = cross * hw < 0; // this side is on the outside of the turn
    const cosT = n0.x * n1.x + n0.y * n1.y;
    if (cosT > 0.9995) {
      out.push(add(v, mul(unit(add(n0, n1)), hw)));
      continue;
    }
    const bis = unit(add(n0, n1));
    const miterLen = 1 / Math.max(1e-6, bis.x * n0.x + bis.y * n0.y); // in units of hw
    if (!outer) {
      // inside of the turn: the offset lines meet at the miter point (clamped so tiny segments don't overshoot)
      out.push(add(v, mul(bis, hw * Math.min(miterLen, 4))));
      continue;
    }
    const p0 = add(v, mul(n0, hw));
    const p1 = add(v, mul(n1, hw));
    if (s.join === 'round') {
      const a0 = Math.atan2(p0.y - v.y, p0.x - v.x);
      let sweep = Math.atan2(p1.y - v.y, p1.x - v.x) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push(p0, ...arc(v, Math.abs(hw), a0, sweep));
    } else if (s.join === 'miter' && miterLen <= limit) {
      out.push(add(v, mul(bis, hw * miterLen)));
    } else {
      out.push(p0, p1);
    }
  }
  return out;
}

function ring(list: Point[]): PathCommand[] {
  const d: PathCommand[] = [['M', list[0].x, list[0].y]];
  for (const p of list.slice(1)) d.push(['L', p.x, p.y]);
  d.push(['Z']);
  return d;
}

/** The area a plain stroke of `d` paints, as closed fillable path(s). */
export function strokeOutline(d: PathCommand[], s: Stroke): PathCommand[] {
  const hw = s.width / 2;
  if (hw <= 0) return [];
  const subs = pathToSubpaths(d);
  const flats = flattenPath(d, 32);
  let polys: Poly[] = [];
  subs.forEach((sp, i) => {
    const pts = clean(flats[i] ?? [], sp.closed);
    if (pts.length >= 2) polys.push({ pts, closed: sp.closed });
  });
  if (s.dash.length) polys = dashPolylines(polys, s.dash, s.dashOffset ?? 0).map((p) => ({ pts: clean(p.pts, false), closed: false })).filter((p) => p.pts.length >= 2);
  const pieces: PathCommand[][] = [];
  for (const { pts: raw, closed } of polys) {
    let pts = raw;
    if (closed) {
      const left = offsetSide(pts, true, hw, s);
      const right = offsetSide(pts, true, -hw, s).reverse();
      pieces.push([...ring(left), ...ring(right)]);
      continue;
    }
    if (s.cap === 'square') {
      const d0 = unit(sub(pts[1], pts[0]));
      const d1 = unit(sub(pts[pts.length - 1], pts[pts.length - 2]));
      pts = [sub(pts[0], mul(d0, hw)), ...pts.slice(1, -1), add(pts[pts.length - 1], mul(d1, hw))];
    }
    const left = offsetSide(pts, false, hw, s);
    const right = offsetSide(pts, false, -hw, s).reverse();
    const ring1: Point[] = [...left];
    if (s.cap === 'round') {
      const e = pts[pts.length - 1];
      const a = Math.atan2(left[left.length - 1].y - e.y, left[left.length - 1].x - e.x);
      ring1.push(...arc(e, hw, a, -Math.PI).slice(0, -1));
    }
    ring1.push(...right);
    if (s.cap === 'round') {
      const b = pts[0];
      const a = Math.atan2(right[right.length - 1].y - b.y, right[right.length - 1].x - b.x);
      ring1.push(...arc(b, hw, a, -Math.PI).slice(0, -1));
    }
    pieces.push(ring(ring1));
  }
  if (!pieces.length) return [];
  if (pieces.length === 1 || pieces.length > 400) return pieces.flat();
  return booleanPaths(pieces, 'add').flat();
}
