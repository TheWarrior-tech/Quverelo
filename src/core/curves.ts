/**
 * Tone curves: control points, monotone cubic interpolation and the per-channel
 * lookup tables the pixel pipeline applies. Pure and DOM-free (unit-tested).
 *
 * Interpolation is Fritsch–Carlson monotone cubic Hermite: the curve passes
 * exactly through every control point, and between two points it never
 * overshoots them, so a curve whose points rise never dips (no inverted
 * tones, no ringing), which is what users expect from a Curves dialog.
 */

export interface CurvePoint {
  /** input level 0..255 */
  x: number;
  /** output level 0..255 */
  y: number;
}

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
export const CURVE_CHANNELS: CurveChannel[] = ['rgb', 'r', 'g', 'b'];

/** One point list per channel. The composite `rgb` curve applies after the colour channel's own curve. */
export type CurvesData = Record<CurveChannel, CurvePoint[]>;

export const IDENTITY_POINTS: readonly CurvePoint[] = Object.freeze([{ x: 0, y: 0 }, { x: 255, y: 255 }]);

export function defaultCurves(): CurvesData {
  return { rgb: identity(), r: identity(), g: identity(), b: identity() };
}

function identity(): CurvePoint[] {
  return IDENTITY_POINTS.map((p) => ({ ...p }));
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Sort by x, clamp to 0..255 and drop points that share an x (keeps the later one). */
export function normalizePoints(points: readonly CurvePoint[]): CurvePoint[] {
  const sorted = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp(p.x, 0, 255), y: clamp(p.y, 0, 255) }))
    .sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of sorted) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 1e-9) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * Monotone cubic interpolant through the points (any order). Returns y for
 * any x; outside the first/last point the curve is flat (clipped black/white
 * point behaviour). Fewer than two points gives the identity line.
 */
export function monotoneCurve(points: readonly CurvePoint[]): (x: number) => number {
  const p = normalizePoints(points);
  const n = p.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => p[0].y;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1].x - p[i].x);
    slope.push((p[i + 1].y - p[i].y) / dx[i]);
  }
  // initial tangents: secant at the ends, average inside, zero at local extrema
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  m.push(slope[n - 2]);
  // Fritsch–Carlson: limit tangents so each segment stays monotone
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  return (x: number) => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    // binary search for the segment
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (p[mid].x <= x) lo = mid;
      else hi = mid;
    }
    const h = dx[lo];
    const t = (x - p[lo].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p[lo].y +
      (t3 - 2 * t2 + t) * h * m[lo] +
      (-2 * t3 + 3 * t2) * p[lo + 1].y +
      (t3 - t2) * h * m[lo + 1]
    );
  };
}

/** 256-entry lookup table for a point list (rounded, clamped to 0..255). */
export function pointsToLut(points: readonly CurvePoint[]): Uint8ClampedArray {
  const f = monotoneCurve(points);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(Math.round(f(i)), 0, 255);
  return lut;
}

export function isIdentity(points: readonly CurvePoint[]): boolean {
  const lut = pointsToLut(points);
  for (let i = 0; i < 256; i++) if (lut[i] !== i) return false;
  return true;
}

/** Final per-channel LUTs: out = rgb[channel[v]]. */
export function curvesLuts(data: CurvesData): { r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray } {
  const master = pointsToLut(data.rgb);
  const compose = (ch: readonly CurvePoint[]) => {
    const own = pointsToLut(ch);
    const out = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) out[i] = master[own[i]];
    return out;
  };
  return { r: compose(data.r), g: compose(data.g), b: compose(data.b) };
}

/**
 * Documents saved before the curve editor stored Curves as three offsets
 * (shadows / midtones / highlights, -100..100 at x = 64 / 128 / 192).
 * Convert them to the equivalent composite point list.
 */
export function legacyCurves(params: Record<string, number | undefined>): CurvesData {
  const s = params.shadows ?? 0;
  const m = params.midtones ?? 0;
  const h = params.highlights ?? 0;
  const c = defaultCurves();
  if (s || m || h) {
    c.rgb = [
      { x: 0, y: 0 },
      { x: 64, y: clamp(64 + s * 0.64, 0, 255) },
      { x: 128, y: clamp(128 + m * 0.64, 0, 255) },
      { x: 192, y: clamp(192 + h * 0.64, 0, 255) },
      { x: 255, y: 255 },
    ];
  }
  return c;
}

/** Read curves from an adjustment, falling back to the legacy three-offset params. */
export function curvesOf(a: { curves?: CurvesData; params: Record<string, number> }): CurvesData {
  if (a.curves) {
    const d = defaultCurves();
    for (const ch of CURVE_CHANNELS) if (a.curves[ch]?.length) d[ch] = a.curves[ch];
    return d;
  }
  return legacyCurves(a.params);
}
