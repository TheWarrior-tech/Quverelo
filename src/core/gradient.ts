/**
 * Gradient geometry shared by every renderer (canvas, SVG, PDF) and the
 * on-canvas gradient editor. Geometry is stored relative to the painted
 * object's box (UnitPoint: 0,0 top-left … 1,1 bottom-right) so a gradient
 * follows its object when it is resized; this module turns it into absolute
 * node-local coordinates.
 */
import type { GradientPaint, GradientStop, Paint, UnitPoint } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GradientGeometry =
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'radial'; cx: number; cy: number; r: number; fx: number; fy: number }
  | { type: 'conical'; cx: number; cy: number; angle: number };

export function isGradient(p: Paint): p is GradientPaint {
  return p.type === 'linear' || p.type === 'radial' || p.type === 'conical';
}

const at = (box: Box, u: UnitPoint) => ({ x: box.x + u.x * box.w, y: box.y + u.y * box.h });
const toUnit = (box: Box, x: number, y: number): UnitPoint => ({
  x: box.w ? (x - box.x) / box.w : 0.5,
  y: box.h ? (y - box.y) / box.h : 0.5,
});

/** Default end points of a linear gradient at `angle` (matches the pre-geometry renderer exactly). */
export function linearDefault(angle: number): { from: UnitPoint; to: UnitPoint } {
  const a = (angle * Math.PI) / 180;
  return {
    from: { x: 0.5 - Math.cos(a) / 2, y: 0.5 - Math.sin(a) / 2 },
    to: { x: 0.5 + Math.cos(a) / 2, y: 0.5 + Math.sin(a) / 2 },
  };
}

/** Absolute geometry of a gradient paint inside `box` (node-local coordinates). */
export function gradientGeometry(p: GradientPaint, box: Box): GradientGeometry {
  switch (p.type) {
    case 'linear': {
      const def = linearDefault(p.angle);
      const a = at(box, p.from ?? def.from);
      const b = at(box, p.to ?? def.to);
      return { type: 'linear', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }
    case 'radial': {
      const c = at(box, p.center ?? { x: 0.5, y: 0.5 });
      const r = p.edge ? Math.hypot(at(box, p.edge).x - c.x, at(box, p.edge).y - c.y) : Math.max(box.w, box.h) / 2;
      const f = p.focal ? at(box, p.focal) : c;
      return { type: 'radial', cx: c.x, cy: c.y, r: Math.max(0.0001, r), fx: f.x, fy: f.y };
    }
    case 'conical': {
      const c = at(box, p.center ?? { x: 0.5, y: 0.5 });
      return { type: 'conical', cx: c.x, cy: c.y, angle: p.angle };
    }
  }
}

/** Editor handles of a gradient, absolute in `box`: start, end (and focal for radial). */
export interface GradientHandles {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export function gradientHandles(p: GradientPaint, box: Box): GradientHandles {
  const g = gradientGeometry(p, box);
  switch (g.type) {
    case 'linear':
      return { start: { x: g.x1, y: g.y1 }, end: { x: g.x2, y: g.y2 } };
    case 'radial':
      return { start: { x: g.cx, y: g.cy }, end: { x: g.cx + g.r, y: g.cy } };
    case 'conical': {
      const a = (g.angle * Math.PI) / 180;
      const r = Math.max(box.w, box.h) / 2;
      return { start: { x: g.cx, y: g.cy }, end: { x: g.cx + Math.cos(a) * r, y: g.cy + Math.sin(a) * r } };
    }
  }
}

/** Gradient with its start/end handles moved to absolute points `start`/`end` in `box`. */
export function setGradientHandles(p: GradientPaint, box: Box, start: { x: number; y: number }, end: { x: number; y: number }): GradientPaint {
  const s = toUnit(box, start.x, start.y);
  const e = toUnit(box, end.x, end.y);
  const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  switch (p.type) {
    case 'linear':
      return { ...p, from: s, to: e, angle: Math.round(((angle % 360) + 360) % 360 * 100) / 100 };
    case 'radial': {
      const out: GradientPaint = { ...p, center: s, edge: e };
      delete (out as { focal?: UnitPoint }).focal;
      return out;
    }
    case 'conical':
      return { ...p, center: s, angle: ((angle % 360) + 360) % 360 };
  }
}

/** Position (0..1) of the point p projected on the gradient's ramp. */
export function rampPosition(p: GradientPaint, box: Box, pt: { x: number; y: number }): number {
  const g = gradientGeometry(p, box);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  switch (g.type) {
    case 'linear': {
      const dx = g.x2 - g.x1;
      const dy = g.y2 - g.y1;
      const len2 = dx * dx + dy * dy || 1;
      return clamp(((pt.x - g.x1) * dx + (pt.y - g.y1) * dy) / len2);
    }
    case 'radial':
      return clamp(Math.hypot(pt.x - g.cx, pt.y - g.cy) / g.r);
    case 'conical': {
      const a = Math.atan2(pt.y - g.cy, pt.x - g.cx) - (g.angle * Math.PI) / 180;
      return (((a / (2 * Math.PI)) % 1) + 1) % 1;
    }
  }
}

/** Insert a stop at `offset`, coloured as the gradient already is there. Returns the new paint and the stop's index. */
export function insertStop(p: GradientPaint, offset: number): { paint: GradientPaint; index: number } {
  const color = colorAt(p.stops, offset);
  const stops = [...p.stops, { offset, color }].sort((a, b) => a.offset - b.offset);
  return { paint: { ...p, stops }, index: stops.findIndex((s) => s.offset === offset && s.color === color) };
}

// ---------------------------------------------------------------------------
// colour interpolation (used for conical wedges in SVG / PDF)

interface Rgba { r: number; g: number; b: number; a: number }

export function parseColor(c: string): Rgba {
  const s = c.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v)));
    const a = m[1].split(/[\s,/]+/).filter(Boolean)[3];
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a) };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');

export function formatColor(c: Rgba): string {
  if (c.a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round(c.a * 1000) / 1000})`;
}

/** Colour of a stop ramp at `t` (stops padded to the ends, like canvas gradients). */
export function colorAt(stops: GradientStop[], t: number): string {
  if (!stops.length) return '#000000';
  const s = [...stops].sort((a, b) => a.offset - b.offset);
  if (t <= s[0].offset) return s[0].color;
  if (t >= s[s.length - 1].offset) return s[s.length - 1].color;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (t >= a.offset && t <= b.offset) {
      const k = b.offset - a.offset ? (t - a.offset) / (b.offset - a.offset) : 0;
      const ca = parseColor(a.color);
      const cb = parseColor(b.color);
      return formatColor({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k, a: ca.a + (cb.a - ca.a) * k });
    }
  }
  return s[s.length - 1].color;
}

/**
 * A conical gradient as `n` solid wedges (for formats without a conic
 * gradient: SVG and PDF). Each wedge spans 360/n degrees and reaches
 * `radius`, which must cover the box.
 */
/** `pad` grows the wedges past the box (a stroke paints outside it) without changing the gradient. */
export function conicalWedges(p: Extract<Paint, { type: 'conical' }>, box: Box, n = 180, pad = 0): { d: string; color: string; points: [number, number][] }[] {
  const g = gradientGeometry(p, box) as Extract<GradientGeometry, { type: 'conical' }>;
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
  const radius = Math.max(...corners.map(([x, y]) => Math.hypot(x - g.cx, y - g.cy))) * 1.05 + 1 + pad;
  const out: { d: string; color: string; points: [number, number][] }[] = [];
  const a0 = (g.angle * Math.PI) / 180;
  const step = (2 * Math.PI) / n;
  // wedges overlap by a hair so no seams show between them
  const eps = step * 0.02;
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step - eps;
    const e = a0 + (i + 1) * step + eps;
    const pts: [number, number][] = [
      [g.cx, g.cy],
      [g.cx + Math.cos(s) * radius, g.cy + Math.sin(s) * radius],
      [g.cx + Math.cos(e) * radius, g.cy + Math.sin(e) * radius],
    ];
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    out.push({
      d: `M${r3(pts[0][0])} ${r3(pts[0][1])}L${r3(pts[1][0])} ${r3(pts[1][1])}L${r3(pts[2][0])} ${r3(pts[2][1])}Z`,
      color: colorAt(p.stops, (i + 0.5) / n),
      points: pts,
    });
  }
  return out;
}
