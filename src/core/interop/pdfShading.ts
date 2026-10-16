/**
 * PDF axial / radial shadings → Quvrelo gradient paints.
 *
 * Quvrelo's gradients are defined on an object's bounding box: a linear
 * gradient runs edge to edge at an angle through the box centre; a radial one
 * is centred with radius = half the longer side. A PDF shading is defined by
 * two points (axial) or two circles (radial) in page space. We re-express the
 * PDF geometry on the object's box: the angle follows the axis, and the stops
 * are re-positioned (and re-sampled at the box edges, as PDF "Extend" does) so
 * the colours land where they were in the PDF.
 */
import type { GradientStop, Paint } from '../types';

export interface Rgba { r: number; g: number; b: number; a: number } // 0..1

export interface Shade {
  kind: 'axial' | 'radial';
  /** page px (y down): axis start/end, or the two circle centres */
  a: [number, number];
  b: [number, number];
  /** radial: radii in page px */
  r0: number;
  r1: number;
  /** colour along the shading parameter t ∈ [0, 1], sorted by t */
  stops: { t: number; c: Rgba }[];
}

export interface Box { x: number; y: number; w: number; h: number }

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
export function rgbaHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 0.999 ? hex2(c.a) : ''}`;
}

/** Colour of the shading at t (clamped: PDF Extend). */
export function colourAt(stops: Shade['stops'], t: number): Rgba {
  if (!stops.length) return { r: 0.5, g: 0.5, b: 0.5, a: 1 };
  if (t <= stops[0].t) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    const s0 = stops[i - 1], s1 = stops[i];
    if (t <= s1.t) {
      const k = s1.t === s0.t ? 1 : (t - s0.t) / (s1.t - s0.t);
      return { r: s0.c.r + (s1.c.r - s0.c.r) * k, g: s0.c.g + (s1.c.g - s0.c.g) * k, b: s0.c.b + (s1.c.b - s0.c.b) * k, a: s0.c.a + (s1.c.a - s0.c.a) * k };
    }
  }
  return stops[stops.length - 1].c;
}

/**
 * Model stops from a mapping u (box parameter) = p + q·t (shading parameter):
 * every PDF stop that falls inside the box, plus the colours at the box edges.
 */
function mapStops(sh: Shade, p: number, q: number, alpha: (c: Rgba) => number): GradientStop[] {
  const out: { offset: number; c: Rgba }[] = [];
  const tAt = (u: number) => (q === 0 ? 0 : (u - p) / q);
  const add = (u: number, c: Rgba) => out.push({ offset: Math.round(u * 10000) / 10000, c });
  add(0, colourAt(sh.stops, tAt(0)));
  for (const s of sh.stops) {
    const u = p + q * s.t;
    if (u > 0 && u < 1) add(u, s.c);
  }
  add(1, colourAt(sh.stops, tAt(1)));
  out.sort((x, y) => x.offset - y.offset);
  return out.map((s) => ({ offset: s.offset, color: rgbaHex({ ...s.c, a: alpha(s.c) }) }));
}

export interface ShadeOptions {
  /** multiply every stop's alpha (fill / stroke opacity) */
  opacity?: number;
  /** use the shade's luminosity as alpha over this colour (soft mask) */
  maskColour?: Rgba;
}

/** The gradient paint that reproduces `sh` on an object whose world box is `box`. */
export function shadeToPaint(sh: Shade, box: Box, o: ShadeOptions = {}): { paint: Paint; offCentre: boolean } {
  const op = o.opacity ?? 1;
  const luminance = (c: Rgba) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const alpha = o.maskColour ? (c: Rgba) => luminance(c) * (o.maskColour!.a) * op : (c: Rgba) => c.a * op;
  const tint = (stops: GradientStop[]) => o.maskColour ? stops.map((s) => ({ ...s, color: rgbaHex({ ...o.maskColour!, a: parseInt(s.color.slice(7, 9) || 'ff', 16) / 255 }) })) : stops;
  const w = Math.max(1e-6, box.w), h = Math.max(1e-6, box.h);
  const cx = box.x + w / 2, cy = box.y + h / 2;
  if (sh.kind === 'axial') {
    const dx = sh.b[0] - sh.a[0], dy = sh.b[1] - sh.a[1];
    // the model's axis is (cos θ·w, sin θ·h); choose θ so it is parallel to the PDF axis
    const angle = Math.atan2(dy / h, dx / w);
    const D: [number, number] = [Math.cos(angle) * w, Math.sin(angle) * h];
    const P0: [number, number] = [cx - D[0] / 2, cy - D[1] / 2];
    const len2 = D[0] * D[0] + D[1] * D[1] || 1;
    const u = (x: number, y: number) => ((x - P0[0]) * D[0] + (y - P0[1]) * D[1]) / len2;
    const uA = u(sh.a[0], sh.a[1]), uB = u(sh.b[0], sh.b[1]);
    const stops = tint(mapStops(sh, uA, uB - uA, alpha));
    return { paint: { type: 'linear', angle: Math.round(((angle * 180) / Math.PI) * 1000) / 1000, stops }, offCentre: false };
  }
  // radial: radius of the model gradient = half the longer side, centred on the box
  const R = Math.max(w, h) / 2;
  const offCentre = Math.hypot(sh.b[0] - cx, sh.b[1] - cy) > R * 0.1 || Math.hypot(sh.a[0] - sh.b[0], sh.a[1] - sh.b[1]) > R * 0.1;
  // radius r(t) = r0 + t (r1 - r0)  →  u = r(t) / R
  const stops = tint(mapStops(sh, sh.r0 / R, (sh.r1 - sh.r0) / R, alpha));
  return { paint: { type: 'radial', stops }, offCentre };
}

/** Sample a 1-in colour function into shade stops: breakpoints plus even samples for curved segments. */
export function sampleStops(fn: (t: number) => Rgba, breakpoints: number[], curved: boolean): Shade['stops'] {
  const ts = new Set<number>([0, 1, ...breakpoints.filter((t) => t > 0 && t < 1)]);
  if (curved) {
    const sorted = [...ts].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) for (let k = 1; k < 8; k++) ts.add(sorted[i - 1] + ((sorted[i] - sorted[i - 1]) * k) / 8);
  }
  return [...ts].sort((a, b) => a - b).map((t) => ({ t, c: fn(t) }));
}
