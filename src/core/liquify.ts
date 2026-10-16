/**
 * Liquify: a backward displacement field over a layer's pixel grid. Output
 * pixel p shows source pixel p + D(p). Brush strokes edit the field (push,
 * twirl, pinch, bloat, reconstruct); warp() renders it. Pure, so the
 * maths is unit-tested without a canvas.
 */
import { createPixels, type Pixels } from './pixels';

export type LiquifyMode = 'push' | 'twirl-cw' | 'twirl-ccw' | 'pinch' | 'bloat' | 'reconstruct';

export const LIQUIFY_MODES: { value: LiquifyMode; label: string }[] = [
  { value: 'push', label: 'Push' },
  { value: 'twirl-cw', label: 'Twirl' },
  { value: 'twirl-ccw', label: 'Twirl left' },
  { value: 'pinch', label: 'Pinch' },
  { value: 'bloat', label: 'Bloat' },
  { value: 'reconstruct', label: 'Reconstruct' },
];

export interface Field {
  w: number;
  h: number;
  dx: Float32Array;
  dy: Float32Array;
}

export function createField(w: number, h: number): Field {
  return { w, h, dx: new Float32Array(w * h), dy: new Float32Array(w * h) };
}

/** Smooth falloff 1 at the centre, 0 at the radius. */
export function falloff(d: number, r: number): number {
  if (d >= r) return 0;
  const t = 1 - (d * d) / (r * r);
  return t * t;
}

function sampleField(f: Field, x: number, y: number): [number, number] {
  const { w, h } = f;
  const cx = Math.max(0, Math.min(w - 1, x));
  const cy = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
  const lx = (a: Float32Array) => (a[i00] * (1 - fx) + a[i10] * fx) * (1 - fy) + (a[i01] * (1 - fx) + a[i11] * fx) * fy;
  return [lx(f.dx), lx(f.dy)];
}

export interface LiquifyDab {
  x: number;
  y: number;
  radius: number;
  /** 0..1 */
  strength: number;
  /** push direction (pixels moved since the last dab) */
  vx?: number;
  vy?: number;
}

/**
 * Apply one brush dab to the field (in place). Each mode maps an output
 * position to where it now reads from (x'), and the field becomes
 * D'(x) = D(x') + (x' - x), so repeated dabs compose without drift.
 */
export function applyDab(f: Field, mode: LiquifyMode, dab: LiquifyDab): void {
  const { w, h } = f;
  const r = Math.max(1, dab.radius);
  const x0 = Math.max(0, Math.floor(dab.x - r)), x1 = Math.min(w - 1, Math.ceil(dab.x + r));
  const y0 = Math.max(0, Math.floor(dab.y - r)), y1 = Math.min(h - 1, Math.ceil(dab.y + r));
  if (x1 < x0 || y1 < y0) return;
  const bw = x1 - x0 + 1;
  const ndx = new Float32Array(bw * (y1 - y0 + 1));
  const ndy = new Float32Array(ndx.length);
  const s = Math.max(0, Math.min(1, dab.strength));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const o = (y - y0) * bw + (x - x0);
      const px = x - dab.x, py = y - dab.y;
      const fo = falloff(Math.hypot(px, py), r) * s;
      ndx[o] = f.dx[i];
      ndy[o] = f.dy[i];
      if (fo <= 0) continue;
      let sx = x, sy = y;
      switch (mode) {
        case 'push':
          sx = x - (dab.vx ?? 0) * fo;
          sy = y - (dab.vy ?? 0) * fo;
          break;
        case 'twirl-cw':
        case 'twirl-ccw': {
          const ang = (mode === 'twirl-cw' ? -1 : 1) * fo * 0.35;
          const c = Math.cos(ang), sn = Math.sin(ang);
          sx = dab.x + px * c - py * sn;
          sy = dab.y + px * sn + py * c;
          break;
        }
        case 'pinch':
          // read from further out: content is drawn towards the centre
          sx = dab.x + px * (1 + 0.25 * fo);
          sy = dab.y + py * (1 + 0.25 * fo);
          break;
        case 'bloat':
          sx = dab.x + px * (1 - 0.25 * fo);
          sy = dab.y + py * (1 - 0.25 * fo);
          break;
        case 'reconstruct':
          ndx[o] = f.dx[i] * (1 - fo);
          ndy[o] = f.dy[i] * (1 - fo);
          continue;
      }
      const [ox, oy] = sampleField(f, sx, sy);
      ndx[o] = ox + (sx - x);
      ndy[o] = oy + (sy - y);
    }
  }
  for (let y = y0; y <= y1; y++) {
    f.dx.set(ndx.subarray((y - y0) * bw, (y - y0 + 1) * bw), y * w + x0);
    f.dy.set(ndy.subarray((y - y0) * bw, (y - y0 + 1) * bw), y * w + x0);
  }
}

/** Bilinear sample of straight RGBA (premultiplied internally). */
function sampleRGBA(src: Pixels, x: number, y: number, out: Float32Array): void {
  const { width: w, height: h, data: d } = src;
  const cx = Math.max(0, Math.min(w - 1, x));
  const cy = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const is = [(y0 * w + x0) * 4, (y0 * w + x1) * 4, (y1 * w + x0) * 4, (y1 * w + x1) * 4];
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let k = 0; k < 4; k++) {
    const i = is[k];
    const a = d[i + 3] * ws[k];
    out[0] += d[i] * a;
    out[1] += d[i + 1] * a;
    out[2] += d[i + 2] * a;
    out[3] += a;
  }
}

/** Render the field: out(p) = src(p + D(p)). Optional rect limits the work (dirty region). */
export function warp(src: Pixels, f: Field, into?: Pixels, rect?: { x: number; y: number; w: number; h: number }): Pixels {
  const out = into ?? createPixels(src.width, src.height);
  const tmp = new Float32Array(4);
  const rx0 = rect ? Math.max(0, Math.floor(rect.x)) : 0;
  const ry0 = rect ? Math.max(0, Math.floor(rect.y)) : 0;
  const rx1 = rect ? Math.min(f.w, Math.ceil(rect.x + rect.w)) : f.w;
  const ry1 = rect ? Math.min(f.h, Math.ceil(rect.y + rect.h)) : f.h;
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const i = y * f.w + x;
      const o = i * 4;
      const ddx = f.dx[i], ddy = f.dy[i];
      if (ddx === 0 && ddy === 0) {
        out.data[o] = src.data[o]; out.data[o + 1] = src.data[o + 1]; out.data[o + 2] = src.data[o + 2]; out.data[o + 3] = src.data[o + 3];
        continue;
      }
      sampleRGBA(src, x + ddx, y + ddy, tmp);
      const a = tmp[3];
      if (a > 0) {
        out.data[o] = tmp[0] / a;
        out.data[o + 1] = tmp[1] / a;
        out.data[o + 2] = tmp[2] / a;
      }
      out.data[o + 3] = a;
    }
  }
  return out;
}

/** Largest displacement in the field (0 = untouched). */
export function maxDisplacement(f: Field): number {
  let m = 0;
  for (let i = 0; i < f.dx.length; i++) m = Math.max(m, Math.hypot(f.dx[i], f.dy[i]));
  return m;
}
