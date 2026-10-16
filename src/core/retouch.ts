/**
 * Retouching dabs (Clone, Healing, Spot healing, Dodge, Burn, Smudge). Each
 * operates in place on a working RGBA buffer around one brush dab, weighted by
 * the brush tip (size, hardness), the dab alpha (flow x pressure) and the
 * optional selection coverage. Pure, so tools and tests share the maths.
 */
import { luminance, type Pixels } from './pixels';

export interface Dab {
  /** centre in pixel coordinates */
  x: number;
  y: number;
  /** radius in pixels */
  r: number;
  /** 0..1, share of the radius at full strength */
  hardness: number;
  /** 0..1 (flow x pressure) */
  alpha: number;
}

/** Brush tip weight at distance d. */
export function tipWeight(d: number, r: number, hardness: number): number {
  if (d >= r) return 0;
  const h = Math.max(0, Math.min(0.999, hardness));
  const inner = r * h;
  if (d <= inner) return 1;
  const t = (d - inner) / (r - inner);
  return 1 - t * t * (3 - 2 * t);
}

type Sel = Uint8ClampedArray | Uint8Array | null;

function forDab(p: Pixels, dab: Dab, sel: Sel, fn: (i: number, wgt: number, x: number, y: number) => void): void {
  const { width: w, height: h } = p;
  const x0 = Math.max(0, Math.floor(dab.x - dab.r)), x1 = Math.min(w - 1, Math.ceil(dab.x + dab.r));
  const y0 = Math.max(0, Math.floor(dab.y - dab.r)), y1 = Math.min(h - 1, Math.ceil(dab.y + dab.r));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let wgt = tipWeight(Math.hypot(x + 0.5 - dab.x, y + 0.5 - dab.y), dab.r, dab.hardness) * dab.alpha;
      if (sel) wgt *= sel[y * w + x] / 255;
      if (wgt > 0) fn((y * w + x) * 4, wgt, x, y);
    }
}

function at(p: Pixels, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= p.width ? p.width - 1 : x;
  const cy = y < 0 ? 0 : y >= p.height ? p.height - 1 : y;
  return (cy * p.width + cx) * 4;
}

/** Clone stamp: copy `src` pixels from (x + ox, y + oy). */
export function cloneDab(work: Pixels, src: Pixels, dab: Dab, ox: number, oy: number, sel: Sel = null): void {
  const d = work.data, s = src.data;
  const rx = Math.round(ox), ry = Math.round(oy);
  forDab(work, dab, sel, (i, wgt, x, y) => {
    const j = at(src, x + rx, y + ry);
    for (let c = 0; c < 4; c++) d[i + c] += (s[j + c] - d[i + c]) * wgt;
  });
}

/** Mean colour of a square window (box), used for the healing brush's low-frequency match. */
function boxMean(p: Pixels, cx: number, cy: number, r: number, out: Float32Array): void {
  let n = 0;
  out[0] = out[1] = out[2] = 0;
  const step = Math.max(1, Math.floor(r / 6));
  for (let y = cy - r; y <= cy + r; y += step)
    for (let x = cx - r; x <= cx + r; x += step) {
      const j = at(p, x, y);
      out[0] += p.data[j];
      out[1] += p.data[j + 1];
      out[2] += p.data[j + 2];
      n++;
    }
  out[0] /= n; out[1] /= n; out[2] /= n;
}

/**
 * Healing brush: texture from the source, colour and tone from the
 * destination. Each pixel takes src + (localMean(dst) - localMean(src)), with
 * the local means taken over a window about half the brush wide.
 */
export function healDab(work: Pixels, src: Pixels, dab: Dab, ox: number, oy: number, sel: Sel = null): void {
  const rx = Math.round(ox), ry = Math.round(oy);
  const win = Math.max(2, Math.round(dab.r * 0.6));
  const md = new Float32Array(3), ms = new Float32Array(3);
  // precompute means on a coarse grid across the dab (bilinear between grid points would be smoother; a 4 px grid is plenty)
  const grid = Math.max(2, Math.round(dab.r / 4));
  const cache = new Map<number, [number, number, number]>();
  const delta = (gx: number, gy: number): [number, number, number] => {
    const k = gy * 65536 + gx;
    let v = cache.get(k);
    if (!v) {
      boxMean(work, gx, gy, win, md);
      boxMean(src, gx + rx, gy + ry, win, ms);
      v = [md[0] - ms[0], md[1] - ms[1], md[2] - ms[2]];
      cache.set(k, v);
    }
    return v;
  };
  const d = work.data, s = src.data;
  const out: [number, number, number, number][] = [];
  const idx: number[] = [];
  forDab(work, dab, sel, (i, wgt, x, y) => {
    const gx0 = Math.floor(x / grid) * grid, gy0 = Math.floor(y / grid) * grid;
    const fx = (x - gx0) / grid, fy = (y - gy0) / grid;
    const a = delta(gx0, gy0), b = delta(gx0 + grid, gy0), c = delta(gx0, gy0 + grid), e = delta(gx0 + grid, gy0 + grid);
    const j = at(src, x + rx, y + ry);
    const px: [number, number, number, number] = [0, 0, 0, wgt];
    for (let ch = 0; ch < 3; ch++) {
      const dl = (a[ch] * (1 - fx) + b[ch] * fx) * (1 - fy) + (c[ch] * (1 - fx) + e[ch] * fx) * fy;
      px[ch] = s[j + ch] + dl;
    }
    out.push(px);
    idx.push(i);
  });
  // write after reading so the means come from the unmodified destination
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const [r, g, b, wgt] = out[k];
    d[i] += (r - d[i]) * wgt;
    d[i + 1] += (g - d[i + 1]) * wgt;
    d[i + 2] += (b - d[i + 2]) * wgt;
  }
}

/**
 * Spot healing: no source point. Looks at candidate patches around the spot
 * and heals from the one whose surrounding ring best matches this spot's ring.
 * Returns the offset it used.
 */
export function spotHealDab(work: Pixels, dab: Dab, sel: Sel = null): { ox: number; oy: number } {
  const r = Math.max(1, dab.r);
  const ring: [number, number][] = [];
  const steps = 24;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    for (const f of [1.05, 1.3]) ring.push([Math.cos(a) * r * f, Math.sin(a) * r * f]);
  }
  let best = { ox: Math.round(2.2 * r), oy: 0 };
  let bestScore = Infinity;
  const d = work.data;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    for (const dist of [2.2, 3]) {
      const ox = Math.round(Math.cos(a) * r * dist), oy = Math.round(Math.sin(a) * r * dist);
      const cx = dab.x + ox, cy = dab.y + oy;
      if (cx - r < 0 || cy - r < 0 || cx + r >= work.width || cy + r >= work.height) continue;
      let score = 0;
      for (const [rx, ry] of ring) {
        const i = at(work, Math.round(dab.x + rx), Math.round(dab.y + ry));
        const j = at(work, Math.round(cx + rx), Math.round(cy + ry));
        score += (d[i] - d[j]) ** 2 + (d[i + 1] - d[j + 1]) ** 2 + (d[i + 2] - d[j + 2]) ** 2;
      }
      // texture inside the candidate (prefer a patch whose own variance looks like the ring's, not a spot)
      const ci = at(work, Math.round(cx), Math.round(cy));
      const ring0 = at(work, Math.round(cx + r), Math.round(cy));
      score += ((d[ci] - d[ring0]) ** 2 + (d[ci + 1] - d[ring0 + 1]) ** 2 + (d[ci + 2] - d[ring0 + 2]) ** 2) * ring.length * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = { ox, oy };
      }
    }
  }
  // membrane blend: texture from the chosen patch, colour from the spot's own surroundings (the
  // ring), interpolated across the spot so the spot itself never tints the result
  const snap = new Uint8ClampedArray(d);
  const rr = r * 1.15;
  const ringPts: { x: number; y: number; diff: [number, number, number] }[] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const x = dab.x + Math.cos(a) * rr, y = dab.y + Math.sin(a) * rr;
    const i = at(work, Math.round(x), Math.round(y));
    const j = at(work, Math.round(x + best.ox), Math.round(y + best.oy));
    ringPts.push({ x, y, diff: [snap[i] - snap[j], snap[i + 1] - snap[j + 1], snap[i + 2] - snap[j + 2]] });
  }
  forDab(work, { ...dab, hardness: Math.max(dab.hardness, 0.6) }, sel, (i, wgt, x, y) => {
    let sw = 0;
    const off = [0, 0, 0];
    for (const q of ringPts) {
      const w = 1 / ((x + 0.5 - q.x) ** 2 + (y + 0.5 - q.y) ** 2 + 1);
      sw += w;
      off[0] += q.diff[0] * w;
      off[1] += q.diff[1] * w;
      off[2] += q.diff[2] * w;
    }
    const j = at(work, x + best.ox, y + best.oy);
    for (let c = 0; c < 3; c++) d[i + c] += (snap[j + c] + off[c] / sw - d[i + c]) * wgt;
  });
  return best;
}

export type ToneRange = 'shadows' | 'midtones' | 'highlights';

/** How much a pixel of lightness l (0..1) belongs to a tonal range. */
export function rangeWeight(l: number, range: ToneRange): number {
  if (range === 'shadows') return (1 - l) * (1 - l);
  if (range === 'highlights') return l * l;
  return 1 - Math.abs(2 * l - 1);
}

/** Dodge (lighten) or burn (darken) the chosen tonal range. exposure 0..1 */
export function dodgeBurnDab(work: Pixels, dab: Dab, burn: boolean, range: ToneRange, exposure: number, sel: Sel = null): void {
  const d = work.data;
  forDab(work, dab, sel, (i, wgt) => {
    const l = luminance(d[i], d[i + 1], d[i + 2]) / 255;
    const k = wgt * exposure * rangeWeight(l, range);
    for (let c = 0; c < 3; c++) d[i + c] = burn ? d[i + c] - d[i + c] * k : d[i + c] + (255 - d[i + c]) * k;
  });
}

/** Smudge state: the colour picked up and carried along the stroke. */
export interface SmudgeState {
  size: number;
  buf: Float32Array;
  ready: boolean;
}

export function createSmudge(r: number): SmudgeState {
  const size = Math.max(1, Math.ceil(r)) * 2 + 1;
  return { size, buf: new Float32Array(size * size * 4), ready: false };
}

/**
 * Smudge: blend the carried colour into the canvas (by brush weight x
 * strength), then pick up a mix of carried and canvas colour for the next dab.
 */
export function smudgeDab(work: Pixels, st: SmudgeState, dab: Dab, strength: number, sel: Sel = null): void {
  const half = (st.size - 1) / 2;
  const cx = Math.round(dab.x), cy = Math.round(dab.y);
  const d = work.data;
  if (!st.ready) {
    for (let y = -half; y <= half; y++)
      for (let x = -half; x <= half; x++) {
        const j = at(work, cx + x, cy + y);
        const b = ((y + half) * st.size + (x + half)) * 4;
        for (let c = 0; c < 4; c++) st.buf[b + c] = d[j + c];
      }
    st.ready = true;
    return;
  }
  const s = Math.max(0, Math.min(1, strength));
  for (let y = -half; y <= half; y++)
    for (let x = -half; x <= half; x++) {
      const px = cx + x, py = cy + y;
      if (px < 0 || py < 0 || px >= work.width || py >= work.height) continue;
      let wgt = tipWeight(Math.hypot(x, y), dab.r, dab.hardness) * dab.alpha;
      if (sel) wgt *= sel[py * work.width + px] / 255;
      const j = (py * work.width + px) * 4;
      const b = ((y + half) * st.size + (x + half)) * 4;
      for (let c = 0; c < 4; c++) {
        if (wgt > 0) d[j + c] += (st.buf[b + c] - d[j + c]) * wgt * s;
        // carry: keep `strength` of the old colour, take the rest from the canvas
        st.buf[b + c] = st.buf[b + c] * s + d[j + c] * (1 - s);
      }
    }
}
