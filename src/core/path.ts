import type { PathCommand } from './types';
import { apply, boundsOfPoints, type Matrix, type Point, type Rect } from './geometry';

const KAPPA = 0.5522847498307936;

export function rectPath(w: number, h: number, radius = 0): PathCommand[] {
  const x = -w / 2;
  const y = -h / 2;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r <= 0) {
    return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  }
  const k = r * (1 - KAPPA);
  return [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['C', x + w - k, y, x + w, y + k, x + w, y + r],
    ['L', x + w, y + h - r],
    ['C', x + w, y + h - k, x + w - k, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['C', x + k, y + h, x, y + h - k, x, y + h - r],
    ['L', x, y + r],
    ['C', x, y + k, x + k, y, x + r, y],
    ['Z'],
  ];
}

export function ellipsePath(w: number, h: number): PathCommand[] {
  const rx = w / 2;
  const ry = h / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    ['M', -rx, 0],
    ['C', -rx, -oy, -ox, -ry, 0, -ry],
    ['C', ox, -ry, rx, -oy, rx, 0],
    ['C', rx, oy, ox, ry, 0, ry],
    ['C', -ox, ry, -rx, oy, -rx, 0],
    ['Z'],
  ];
}

export function polygonPoints(w: number, h: number, sides: number): Point[] {
  const n = Math.max(3, Math.round(sides));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * h) / 2 });
  }
  return pts;
}

export function starPoints(w: number, h: number, points: number, innerRatio: number): Point[] {
  const n = Math.max(3, Math.round(points));
  const pts: Point[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : Math.max(0.05, Math.min(1, innerRatio));
    pts.push({ x: (Math.cos(a) * w * r) / 2, y: (Math.sin(a) * h * r) / 2 });
  }
  return pts;
}

export function pointsToPath(pts: Point[], closed = true): PathCommand[] {
  if (!pts.length) return [];
  const d: PathCommand[] = [['M', pts[0].x, pts[0].y]];
  for (let i = 1; i < pts.length; i++) d.push(['L', pts[i].x, pts[i].y]);
  if (closed) d.push(['Z']);
  return d;
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

export function pathToString(d: PathCommand[]): string {
  return d.map((c) => c[0] + (c.length > 1 ? (c.slice(1) as number[]).map(fmt).join(' ') : '')).join(' ');
}

/** Parse SVG path data into absolute M/L/C/Q/Z commands. Arcs become cubics. */
export function parsePath(src: string): PathCommand[] {
  const tokens = src.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: PathCommand[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Point | null = null;
  let lastQuad: Point | null = null;
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (C) {
      case 'M': {
        cx = num() + ox;
        cy = num() + oy;
        sx = cx;
        sy = cy;
        out.push(['M', cx, cy]);
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQuad = null;
        break;
      }
      case 'L':
        cx = num() + ox;
        cy = num() + oy;
        out.push(['L', cx, cy]);
        lastCtrl = lastQuad = null;
        break;
      case 'H':
        cx = num() + ox;
        out.push(['L', cx, cy]);
        lastCtrl = lastQuad = null;
        break;
      case 'V':
        cy = num() + oy;
        out.push(['L', cx, cy]);
        lastCtrl = lastQuad = null;
        break;
      case 'C': {
        const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy;
        cx = num() + ox;
        cy = num() + oy;
        out.push(['C', x1, y1, x2, y2, cx, cy]);
        lastCtrl = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case 'S': {
        const x1: number = lastCtrl ? 2 * cx - lastCtrl.x : cx;
        const y1: number = lastCtrl ? 2 * cy - lastCtrl.y : cy;
        const x2 = num() + ox, y2 = num() + oy;
        cx = num() + ox;
        cy = num() + oy;
        out.push(['C', x1, y1, x2, y2, cx, cy]);
        lastCtrl = { x: x2, y: y2 };
        lastQuad = null;
        break;
      }
      case 'Q': {
        const x1 = num() + ox, y1 = num() + oy;
        cx = num() + ox;
        cy = num() + oy;
        out.push(['Q', x1, y1, cx, cy]);
        lastQuad = { x: x1, y: y1 };
        lastCtrl = null;
        break;
      }
      case 'T': {
        const x1: number = lastQuad ? 2 * cx - lastQuad.x : cx;
        const y1: number = lastQuad ? 2 * cy - lastQuad.y : cy;
        cx = num() + ox;
        cy = num() + oy;
        out.push(['Q', x1, y1, cx, cy]);
        lastQuad = { x: x1, y: y1 };
        lastCtrl = null;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        const x = num() + ox, y = num() + oy;
        for (const c of arcToCubics(cx, cy, rx, ry, rot, !!large, !!sweep, x, y)) out.push(c);
        cx = x;
        cy = y;
        lastCtrl = lastQuad = null;
        break;
      }
      case 'Z':
        out.push(['Z']);
        cx = sx;
        cy = sy;
        lastCtrl = lastQuad = null;
        break;
      default:
        i++;
    }
    if (C === 'Z' && isNum()) cmd = 'L';
  }
  return out;
}

function arcToCubics(
  x1: number, y1: number, rx: number, ry: number, angle: number,
  largeArc: boolean, sweep: boolean, x2: number, y2: number,
): PathCommand[] {
  if (rx === 0 || ry === 0) return [['L', x2, y2]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: PathCommand[] = [];
  let th = theta1;
  for (let s = 0; s < segs; s++) {
    const c1 = Math.cos(th), s1 = Math.sin(th);
    const c2 = Math.cos(th + delta), s2 = Math.sin(th + delta);
    const p1 = { x: c1 - t * s1, y: s1 + t * c1 };
    const p2 = { x: c2 + t * s2, y: s2 - t * c2 };
    const p3 = { x: c2, y: s2 };
    const map = (p: Point): [number, number] => [
      cx + rx * p.x * cos - ry * p.y * sin,
      cy + rx * p.x * sin + ry * p.y * cos,
    ];
    out.push(['C', ...map(p1), ...map(p2), ...map(p3)]);
    th += delta;
  }
  return out;
}

export function transformPath(d: PathCommand[], m: Matrix): PathCommand[] {
  return d.map((c): PathCommand => {
    switch (c[0]) {
      case 'M':
      case 'L': {
        const p = apply(m, { x: c[1], y: c[2] });
        return [c[0], p.x, p.y];
      }
      case 'C': {
        const a = apply(m, { x: c[1], y: c[2] });
        const b = apply(m, { x: c[3], y: c[4] });
        const e = apply(m, { x: c[5], y: c[6] });
        return ['C', a.x, a.y, b.x, b.y, e.x, e.y];
      }
      case 'Q': {
        const a = apply(m, { x: c[1], y: c[2] });
        const e = apply(m, { x: c[3], y: c[4] });
        return ['Q', a.x, a.y, e.x, e.y];
      }
      default:
        return ['Z'];
    }
  });
}

export function translatePath(d: PathCommand[], dx: number, dy: number): PathCommand[] {
  return transformPath(d, [1, 0, 0, 1, dx, dy]);
}

/** Points sampled along the path (curves flattened), useful for bounds and hit tests. */
export function flattenPath(d: PathCommand[], steps = 16): Point[][] {
  const subpaths: Point[][] = [];
  let cur: Point[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const c of d) {
    switch (c[0]) {
      case 'M':
        if (cur.length) subpaths.push(cur);
        cur = [{ x: c[1], y: c[2] }];
        x = sx = c[1];
        y = sy = c[2];
        break;
      case 'L':
        cur.push({ x: c[1], y: c[2] });
        x = c[1];
        y = c[2];
        break;
      case 'C':
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          cur.push({
            x: mt ** 3 * x + 3 * mt * mt * t * c[1] + 3 * mt * t * t * c[3] + t ** 3 * c[5],
            y: mt ** 3 * y + 3 * mt * mt * t * c[2] + 3 * mt * t * t * c[4] + t ** 3 * c[6],
          });
        }
        x = c[5];
        y = c[6];
        break;
      case 'Q':
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          cur.push({
            x: mt * mt * x + 2 * mt * t * c[1] + t * t * c[3],
            y: mt * mt * y + 2 * mt * t * c[2] + t * t * c[4],
          });
        }
        x = c[3];
        y = c[4];
        break;
      case 'Z':
        if (cur.length) cur.push({ x: sx, y: sy });
        x = sx;
        y = sy;
        break;
    }
  }
  if (cur.length) subpaths.push(cur);
  return subpaths;
}

export function pathBounds(d: PathCommand[]): Rect {
  return boundsOfPoints(flattenPath(d).flat());
}

/** Re-centre a path on its bounds; returns the centred path and the old centre. */
export function centrePath(d: PathCommand[]): { d: PathCommand[]; cx: number; cy: number; w: number; h: number } {
  const b = pathBounds(d);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { d: translatePath(d, -cx, -cy), cx, cy, w: b.w, h: b.h };
}

/** Even-odd point-in-polygon test against a flattened path. */
export function pointInPath(d: PathCommand[], p: Point): boolean {
  let inside = false;
  for (const poly of flattenPath(d, 8)) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Editable anchor representation used by the node tool. */
export interface Anchor {
  x: number;
  y: number;
  /** incoming handle (absolute), null when the segment into this anchor is straight */
  inX: number | null;
  inY: number | null;
  outX: number | null;
  outY: number | null;
}

export interface Subpath {
  anchors: Anchor[];
  closed: boolean;
}

export function pathToSubpaths(d: PathCommand[]): Subpath[] {
  const subs: Subpath[] = [];
  let cur: Subpath | null = null;
  for (const c of d) {
    if (c[0] === 'M') {
      cur = { anchors: [{ x: c[1], y: c[2], inX: null, inY: null, outX: null, outY: null }], closed: false };
      subs.push(cur);
    } else if (!cur) {
      continue;
    } else if (c[0] === 'L') {
      cur.anchors.push({ x: c[1], y: c[2], inX: null, inY: null, outX: null, outY: null });
    } else if (c[0] === 'C') {
      const prev = cur.anchors[cur.anchors.length - 1];
      prev.outX = c[1];
      prev.outY = c[2];
      cur.anchors.push({ x: c[5], y: c[6], inX: c[3], inY: c[4], outX: null, outY: null });
    } else if (c[0] === 'Q') {
      const prev = cur.anchors[cur.anchors.length - 1];
      // elevate quadratic to cubic
      prev.outX = prev.x + (2 / 3) * (c[1] - prev.x);
      prev.outY = prev.y + (2 / 3) * (c[2] - prev.y);
      cur.anchors.push({
        x: c[3], y: c[4],
        inX: c[3] + (2 / 3) * (c[1] - c[3]), inY: c[4] + (2 / 3) * (c[2] - c[4]),
        outX: null, outY: null,
      });
    } else if (c[0] === 'Z') {
      cur.closed = true;
      // merge duplicated closing anchor
      const a = cur.anchors;
      if (a.length > 1) {
        const first = a[0];
        const last = a[a.length - 1];
        if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
          first.inX = last.inX;
          first.inY = last.inY;
          a.pop();
        }
      }
    }
  }
  return subs;
}

export function subpathsToPath(subs: Subpath[]): PathCommand[] {
  const d: PathCommand[] = [];
  for (const s of subs) {
    if (!s.anchors.length) continue;
    const a = s.anchors;
    d.push(['M', a[0].x, a[0].y]);
    const seg = (p: Anchor, q: Anchor) => {
      if (p.outX === null && q.inX === null) d.push(['L', q.x, q.y]);
      else d.push(['C', p.outX ?? p.x, p.outY ?? p.y, q.inX ?? q.x, q.inY ?? q.y, q.x, q.y]);
    };
    for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i]);
    if (s.closed) {
      if (a.length > 1 && (a[a.length - 1].outX !== null || a[0].inX !== null)) seg(a[a.length - 1], a[0]);
      d.push(['Z']);
    }
  }
  return d;
}
