import type { Transform } from './types';

/** 2D affine matrix [a, b, c, d, e, f] (same layout as canvas/SVG/fabric). */
export type Matrix = [number, number, number, number, number, number];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const DEG = Math.PI / 180;

export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const r = 1 / det;
  return [
    m[3] * r,
    -m[1] * r,
    -m[2] * r,
    m[0] * r,
    (m[2] * m[5] - m[3] * m[4]) * r,
    (m[1] * m[4] - m[0] * m[5]) * r,
  ];
}

export function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function translate(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function rotate(deg: number): Matrix {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function scale(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function skewX(deg: number): Matrix {
  return [1, 0, Math.tan(deg * DEG), 1, 0, 0];
}

/** Compose a node transform exactly like fabric.util.composeMatrix (origin centre). */
export function composeTransform(t: Pick<Transform, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'flipX' | 'flipY'>): Matrix {
  let m = translate(t.x, t.y);
  if (t.rotation) m = multiply(m, rotate(t.rotation));
  m = multiply(m, scale(t.scaleX * (t.flipX ? -1 : 1), t.scaleY * (t.flipY ? -1 : 1)));
  if (t.skewX) m = multiply(m, skewX(t.skewX));
  return m;
}

/** Decompose a matrix into translate/rotate/scale/skewX (fabric qrDecompose). */
export function decompose(m: Matrix): Pick<Transform, 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'flipX' | 'flipY'> {
  const angle = Math.atan2(m[1], m[0]);
  const denom = m[0] ** 2 + m[1] ** 2;
  const scaleX = Math.sqrt(denom);
  const scaleY = denom === 0 ? 0 : (m[0] * m[3] - m[2] * m[1]) / scaleX;
  const skew = denom === 0 ? 0 : Math.atan2(m[0] * m[2] + m[1] * m[3], denom);
  return {
    x: m[4],
    y: m[5],
    rotation: normaliseAngle(angle / DEG),
    scaleX,
    scaleY: Math.abs(scaleY),
    skewX: skew / DEG,
    flipX: false,
    flipY: scaleY < 0,
  };
}

export function normaliseAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  if (Math.abs(a - 360) < 1e-9) a = 0;
  return Math.round(a * 1e6) / 1e6;
}

export function boundsOfPoints(points: Point[]): Rect {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionRects(rects: Rect[]): Rect {
  const pts: Point[] = [];
  for (const r of rects) {
    pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
  }
  return boundsOfPoints(pts);
}

export function rectCorners(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function transformRect(m: Matrix, r: Rect): Rect {
  return boundsOfPoints(rectCorners(r).map((p) => apply(m, p)));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function round(v: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
