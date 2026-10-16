/**
 * Edge refinement / soft matting for ML selections (hair, fur, soft edges). Pure TS, no DOM.
 *
 * The network runs at a few hundred pixels, so its probability map is blurry at full resolution and thin
 * structures (hair strands, whiskers) are lost. `refineMatte` turns that probability into a soft alpha matte
 * at image resolution:
 *
 *  1. Trimap from the network's 0.5 contour: sure foreground a little inside it, sure background beyond
 *     `band` px outside it, unknown in between (the band is where strands the network blurred away live).
 *  2. Local two-colour model: F and B are the mean colours of nearby sure-foreground / sure-background pixels
 *     (normalised box filters), and alpha is the projection of each unknown pixel's colour onto the F-B line,
 *     i.e. the colour-line model behind closed-form matting (Levin et al. 2008), solved locally in O(N).
 *     Where F and B are too similar to separate, the network's probability is kept.
 *  3. A colour guided filter (He, Sun & Tang, TPAMI 2013) denoises the unknown band while keeping strand edges.
 *
 * Every box filter uses an integral image, so cost does not depend on the radius (~0.3-0.7 s at 1024 px in Node,
 * see ml/MODEL_CARD.md).
 */
import type { MaskImage, RgbaImage } from './tensor';

export interface MatteOptions {
  /** guided-filter (denoise) window radius in image px (default: 0.4 % of the long side, min 2) */
  radius?: number;
  /** regulariser; smaller = follows colour edges more closely (default 1e-3 on 0..1 colour) */
  eps?: number;
  /** estimate the local F/B colours and the guided-filter coefficients at 1/subsample resolution (default 1 = exact) */
  subsample?: number;
  /** width in px of the unknown band outside the 0.5 contour (default: max(1.5 % of the long side, 3 x modelScale), min 4) */
  band?: number;
  /** depth in px of the unknown band inside the 0.5 contour (default: max(2, 2 x modelScale)) */
  inner?: number;
  /**
   * image px per network output px (image long side / model input size). The network's contour is uncertain by
   * a couple of its own pixels, so the unknown band scales with it. Default 1.
   */
  modelScale?: number;
}

/**
 * Box mean over a (2r+1)^2 window with clamped borders. Separable running sums (a clamped window is a rectangle, so
 * the mean of the row means over it is the window mean): O(N) whatever the radius, no integral image.
 */
export function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const invX = new Float32Array(w), invY = new Float32Array(h);
  for (let x = 0; x < w; x++) invX[x] = 1 / (Math.min(w, x + r + 1) - Math.max(0, x - r));
  for (let y = 0; y < h; y++) invY[y] = 1 / (Math.min(h, y + r + 1) - Math.max(0, y - r));
  // horizontal
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x < Math.min(w, r); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) s += src[o + x + r];
      if (x - r - 1 >= 0) s -= src[o + x - r - 1];
      tmp[o + x] = s * invX[x];
    }
  }
  // vertical (row-wise sweeps over a column-sum accumulator, cache friendly)
  const acc = new Float64Array(w);
  for (let y = 0; y < Math.min(h, r); y++) for (let x = 0, o = y * w; x < w; x++) acc[x] += tmp[o + x];
  for (let y = 0; y < h; y++) {
    if (y + r < h) for (let x = 0, o = (y + r) * w; x < w; x++) acc[x] += tmp[o + x];
    if (y - r - 1 >= 0) for (let x = 0, o = (y - r - 1) * w; x < w; x++) acc[x] -= tmp[o + x];
    const iy = invY[y], o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = acc[x] * iy;
  }
  return out;
}

/** Euclidean-ish distance (chamfer 3-4) to the nearest pixel where `inside` differs from its neighbour. */
function distanceToEdge(bin: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h).fill(INF);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = bin[i];
      if ((x > 0 && bin[i - 1] !== v) || (x < w - 1 && bin[i + 1] !== v) || (y > 0 && bin[i - w] !== v) || (y < h - 1 && bin[i + w] !== v)) d[i] = 0;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/**
 * Colour guided filter of `p` (w x h) guided by RGB planes I (0..1). Returns the filtered plane.
 * Solves a_k = (Sigma_k + eps U)^-1 cov(I, p)_k, b_k = mean(p) - a_k . mean(I) per window.
 */
export function colourGuidedFilter(I: [Float32Array, Float32Array, Float32Array], p: Float32Array, w: number, h: number, r: number, eps: number): { a: [Float32Array, Float32Array, Float32Array]; b: Float32Array } {
  const n = w * h;
  const [R, G, B] = I;
  const mR = boxMean(R, w, h, r), mG = boxMean(G, w, h, r), mB = boxMean(B, w, h, r), mP = boxMean(p, w, h, r);
  const prod = (a: Float32Array, b: Float32Array) => {
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = a[i] * b[i];
    return boxMean(o, w, h, r);
  };
  const cRP = prod(R, p), cGP = prod(G, p), cBP = prod(B, p);
  const vRR = prod(R, R), vRG = prod(R, G), vRB = prod(R, B), vGG = prod(G, G), vGB = prod(G, B), vBB = prod(B, B);
  const aR = new Float32Array(n), aG = new Float32Array(n), aB = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r0 = mR[i], g0 = mG[i], b0 = mB[i], p0 = mP[i];
    const xr = cRP[i] - r0 * p0, xg = cGP[i] - g0 * p0, xb = cBP[i] - b0 * p0;
    const s00 = vRR[i] - r0 * r0 + eps, s01 = vRG[i] - r0 * g0, s02 = vRB[i] - r0 * b0;
    const s11 = vGG[i] - g0 * g0 + eps, s12 = vGB[i] - g0 * b0, s22 = vBB[i] - b0 * b0 + eps;
    // inverse of the symmetric 3x3 via cofactors
    const c00 = s11 * s22 - s12 * s12, c01 = s02 * s12 - s01 * s22, c02 = s01 * s12 - s02 * s11;
    const c11 = s00 * s22 - s02 * s02, c12 = s01 * s02 - s00 * s12, c22 = s00 * s11 - s01 * s01;
    const det = s00 * c00 + s01 * c01 + s02 * c02;
    const inv = det > 1e-12 ? 1 / det : 0;
    const ar = (c00 * xr + c01 * xg + c02 * xb) * inv;
    const ag = (c01 * xr + c11 * xg + c12 * xb) * inv;
    const ab = (c02 * xr + c12 * xg + c22 * xb) * inv;
    aR[i] = ar; aG[i] = ag; aB[i] = ab;
    b[i] = p0 - ar * r0 - ag * g0 - ab * b0;
  }
  return { a: [boxMean(aR, w, h, r), boxMean(aG, w, h, r), boxMean(aB, w, h, r)], b: boxMean(b, w, h, r) };
}

/** Mean over sub x sub blocks (the last row / column of blocks may be partial): ceil(w/sub) x ceil(h/sub). */
export function blockMean(src: Float32Array, w: number, h: number, sub: number): Float32Array {
  const bw = Math.ceil(w / sub), bh = Math.ceil(h / sub);
  const sum = new Float32Array(bw * bh), cnt = new Float32Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const row = ((y / sub) | 0) * bw;
    for (let x = 0; x < w; x++) {
      const k = row + ((x / sub) | 0);
      sum[k] += src[y * w + x]; cnt[k]++;
    }
  }
  for (let k = 0; k < sum.length; k++) sum[k] /= cnt[k];
  return sum;
}

function planesOf(img: RgbaImage): [Float32Array, Float32Array, Float32Array] {
  const n = img.width * img.height;
  const P: [Float32Array, Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) P[c][p] = (img.data[i + c] * a + 255 * (1 - a)) / 255;
  }
  return P;
}

/** Normalised box mean of `v` over pixels where `w` is 1: sum(v w) / sum(w) in each window (NaN-free: 0 where empty). */
function maskedMean(v: Float32Array, w: Float32Array, W: number, H: number, r: number): { mean: Float32Array; weight: Float32Array } {
  const vw = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) vw[i] = v[i] * w[i];
  const num = boxMean(vw, W, H, r);
  const den = boxMean(w, W, H, r);
  for (let i = 0; i < num.length; i++) num[i] = den[i] > 1e-6 ? num[i] / den[i] : 0;
  return { mean: num, weight: den };
}

/**
 * Refine a probability map (0..1, image resolution) into a soft alpha matte (0..255) at image resolution.
 * `prob` must be img.width x img.height.
 *
 * Unknown-band alpha comes from a local two-colour model: F and B are the mean colours of the nearby sure-foreground
 * and sure-background pixels (normalised box filters), and alpha is the projection of the pixel colour onto the
 * F-B line, the colour-line assumption behind closed-form matting. That is what recovers strands that the
 * low-resolution network blurred away. Where F and B are too similar to separate, the network's probability is kept.
 * A small colour guided filter then removes per-pixel noise while keeping strand edges.
 */
export function refineMatte(img: RgbaImage, prob: Float32Array, opts: MatteOptions = {}): MaskImage {
  const { width: W, height: H } = img;
  const n = W * H;
  if (prob.length !== n) throw new Error('refineMatte: prob size mismatch');
  const long = Math.max(W, H);
  const r = Math.max(2, Math.round(opts.radius ?? 0.004 * long));
  const eps = opts.eps ?? 1e-3;
  const sub = Math.max(1, Math.min(4, Math.round(opts.subsample ?? 1)));
  const ms = Math.max(1, opts.modelScale ?? 1);
  const band = Math.max(4, opts.band ?? Math.max(0.015 * long, 3 * ms));
  if (sub > 1) return refineMatteFast(img, prob, { sub, r, eps, band, inner: Math.max(2, opts.inner ?? 2 * ms) });
  const I = planesOf(img);
  // 1. trimap from the 0.5 contour
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = prob[i] >= 0.5 ? 1 : 0;
  const dist = distanceToEdge(bin, W, H);
  const inner = Math.max(2, opts.inner ?? 2 * ms);
  const fgSure = new Float32Array(n), bgSure = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (bin[i] && dist[i] > inner) fgSure[i] = 1;
    else if (!bin[i] && dist[i] > band) bgSure[i] = 1;
  }
  // 2. local F / B colours, gathered from just beyond the band
  const R = Math.max(3, Math.round(band * 1.5));
  const gr = Math.max(1, Math.round(r / 2));
  const alpha = new Float32Array(n);
  const out = new Uint8Array(n);
  const finish = (v: number) => {
    v = (v - 0.04) / 0.92; // remove the faint haze left in flat background
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  // alpha of one unknown-band pixel from its local F / B colours (fw, bw: how much sure F / B the window saw)
  const unknownAlpha = (i: number, f0: number, f1: number, f2: number, b0: number, b1: number, b2: number, fw: number, bw: number) => {
    const dr = f0 - b0, dg = f1 - b1, db = f2 - b2;
    const d2 = dr * dr + dg * dg + db * db;
    const p = prob[i];
    if (fw < 1e-3 || bw < 1e-3 || d2 < 0.01) return p; // cannot separate: keep the network
    const a = ((I[0][i] - b0) * dr + (I[1][i] - b1) * dg + (I[2][i] - b2) * db) / d2;
    // confidence grows with F-B contrast; low contrast leans on the network
    const conf = Math.min(1, (Math.sqrt(d2) - 0.1) / 0.2);
    const ac = Math.min(1, Math.max(0, a));
    return conf > 0 ? conf * ac + (1 - conf) * p : p;
  };
  const F: Float32Array[] = [], B: Float32Array[] = [];
  let fw: Float32Array = new Float32Array(0), bw: Float32Array = new Float32Array(0);
  for (let c = 0; c < 3; c++) {
    const f = maskedMean(I[c], fgSure, W, H, R), b = maskedMean(I[c], bgSure, W, H, R);
    F.push(f.mean); B.push(b.mean); fw = f.weight; bw = b.weight;
  }
  for (let i = 0; i < n; i++)
    alpha[i] = fgSure[i] ? 1 : bgSure[i] ? 0 : unknownAlpha(i, F[0][i], F[1][i], F[2][i], B[0][i], B[1][i], B[2][i], fw[i], bw[i]);
  // 3. light colour guided filter (edge-preserving denoise), only applied inside the band
  const { a: ga, b: gb } = colourGuidedFilter(I, alpha, W, H, gr, eps * 0.1);
  for (let i = 0; i < n; i++)
    out[i] = finish(fgSure[i] || bgSure[i] ? alpha[i] : ga[0][i] * I[0][i] + ga[1][i] * I[1][i] + ga[2][i] * I[2][i] + gb[i]);
  return { width: W, height: H, data: out };
}

interface FastParams { sub: number; r: number; eps: number; band: number; inner: number }

/**
 * Subsampled ("fast") matte, the fast guided filter of He & Sun 2015 applied to the whole pipeline: the trimap, the local
 * F / B colours, the band alpha and the guided-filter coefficients are all solved on sub x sub block averages, and only
 * the final a.I + b of each unknown-band pixel is evaluated at full resolution against the full-resolution colour, so
 * strand edges stay sharp. Every full-resolution pass is a single sweep (no full-resolution planes, box filters or
 * distance transform), which is what keeps a 1024 px matte well under the Select Subject latency budget.
 */
function refineMatteFast(img: RgbaImage, prob: Float32Array, o: FastParams): MaskImage {
  const { width: W, height: H, data } = img;
  const sub = o.sub;
  const w = Math.ceil(W / sub), h = Math.ceil(H / sub), m = w * h;
  const xb = new Int32Array(W), yb = new Int32Array(H);
  for (let x = 0; x < W; x++) xb[x] = (x / sub) | 0;
  for (let y = 0; y < H; y++) yb[y] = (y / sub) | 0;
  // 1. one full-resolution sweep: block means of colour (composited on white, 0..1) and probability
  const I0 = new Float32Array(m), I1 = new Float32Array(m), I2 = new Float32Array(m);
  const I: [Float32Array, Float32Array, Float32Array] = [I0, I1, I2];
  const P = new Float32Array(m), cnt = new Float32Array(m);
  for (let y = 0, i = 0; y < H; y++) {
    const row = yb[y] * w;
    for (let x = 0; x < W; x++, i++) {
      const k = row + xb[x], j = i << 2, A = data[j + 3];
      if (A === 255) { I0[k] += data[j]; I1[k] += data[j + 1]; I2[k] += data[j + 2]; }
      else { const a = A / 255, wh = 255 - A; I0[k] += data[j] * a + wh; I1[k] += data[j + 1] * a + wh; I2[k] += data[j + 2] * a + wh; }
      P[k] += prob[i]; cnt[k]++;
    }
  }
  for (let k = 0; k < m; k++) {
    const c = 1 / cnt[k], c255 = c / 255;
    I0[k] *= c255; I1[k] *= c255; I2[k] *= c255; P[k] *= c;
  }
  // 2. trimap at low resolution (distances converted back to full-resolution px)
  const bin = new Uint8Array(m);
  for (let k = 0; k < m; k++) bin[k] = P[k] >= 0.5 ? 1 : 0;
  const dist = distanceToEdge(bin, w, h);
  const fg = new Float32Array(m), bg = new Float32Array(m);
  const cls = new Uint8Array(m); // 0 unknown, 1 sure foreground, 2 sure background
  for (let k = 0; k < m; k++) {
    const d = dist[k] * sub;
    if (bin[k] && d > o.inner) { fg[k] = 1; cls[k] = 1; } else if (!bin[k] && d > o.band) { bg[k] = 1; cls[k] = 2; }
  }
  // 3-4 only need the neighbourhood of the unknown band: crop the low-resolution planes to its bounding box plus the
  // filter reach, so a compact subject costs a fraction of the frame
  const Rs = Math.max(1, Math.round(Math.max(3, Math.round(o.band * 1.5)) / sub));
  const grs = Math.max(1, Math.round(Math.max(1, Math.round(o.r / 2)) / sub));
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0, k = 0; y < h; y++)
    for (let x = 0; x < w; x++, k++)
      if (!cls[k]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const out = new Uint8Array(W * H);
  if (bx1 < 0) { // no unknown band at all
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) out[i] = cls[yb[y] * w + xb[x]] === 1 ? 255 : 0;
    return { width: W, height: H, data: out };
  }
  const mg = Rs + 2 * grs + 2;
  bx0 = Math.max(0, bx0 - mg); by0 = Math.max(0, by0 - mg); bx1 = Math.min(w - 1, bx1 + mg); by1 = Math.min(h - 1, by1 + mg);
  const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1, cm = cw * ch;
  const crop = (src: Float32Array) => {
    const c = new Float32Array(cm);
    for (let y = 0; y < ch; y++) c.set(src.subarray((y + by0) * w + bx0, (y + by0) * w + bx0 + cw), y * cw);
    return c;
  };
  const Ic: [Float32Array, Float32Array, Float32Array] = [crop(I[0]), crop(I[1]), crop(I[2])];
  const Pc = crop(P), fgc = crop(fg), bgc = crop(bg);
  // 3. local F / B colours (normalised box filters; the weights are shared by the three channels) and the band
  //    alpha (colour-line projection), at low resolution
  const fw = boxMean(fgc, cw, ch, Rs), bw = boxMean(bgc, cw, ch, Rs);
  const local = (plane: Float32Array, wt: Float32Array, den: Float32Array) => {
    const v = new Float32Array(cm);
    for (let k = 0; k < cm; k++) v[k] = plane[k] * wt[k];
    const num = boxMean(v, cw, ch, Rs);
    for (let k = 0; k < cm; k++) num[k] = den[k] > 1e-6 ? num[k] / den[k] : 0;
    return num;
  };
  const F = [local(Ic[0], fgc, fw), local(Ic[1], fgc, fw), local(Ic[2], fgc, fw)];
  const B = [local(Ic[0], bgc, bw), local(Ic[1], bgc, bw), local(Ic[2], bgc, bw)];
  const alpha = new Float32Array(cm);
  for (let k = 0; k < cm; k++) {
    if (fgc[k]) { alpha[k] = 1; continue; }
    if (bgc[k]) { alpha[k] = 0; continue; }
    const dr = F[0][k] - B[0][k], dg = F[1][k] - B[1][k], db = F[2][k] - B[2][k];
    const d2 = dr * dr + dg * dg + db * db, p = Pc[k];
    if (fw[k] < 1e-3 || bw[k] < 1e-3 || d2 < 0.01) { alpha[k] = p; continue; }
    const a = ((Ic[0][k] - B[0][k]) * dr + (Ic[1][k] - B[1][k]) * dg + (Ic[2][k] - B[2][k]) * db) / d2;
    const conf = Math.min(1, (Math.sqrt(d2) - 0.1) / 0.2);
    const ac = Math.min(1, Math.max(0, a));
    alpha[k] = conf > 0 ? conf * ac + (1 - conf) * p : p;
  }
  // 4. guided-filter coefficients at low resolution
  const g = colourGuidedFilter(Ic, alpha, cw, ch, grs, o.eps * 0.1);
  // 5. full-resolution output: sure pixels straight from the trimap, band pixels a.I + b with bilinear coefficients
  const fx = new Float32Array(W), fy = new Float32Array(H);
  const x0 = new Int32Array(W), x1 = new Int32Array(W), y0 = new Int32Array(H), y1 = new Int32Array(H);
  const axis = (N: number, M: number, i0: Int32Array, i1: Int32Array, fr: Float32Array) => {
    for (let x = 0; x < N; x++) {
      const u = Math.min(M - 1, Math.max(0, (x + 0.5) / sub - 0.5));
      const j = Math.min(M - 1, Math.floor(u));
      i0[x] = j; i1[x] = Math.min(M - 1, j + 1); fr[x] = u - j;
    }
  };
  axis(W, w, x0, x1, fx); axis(H, h, y0, y1, fy);
  // low-resolution sample positions -> crop coordinates (unknown pixels and their bilinear neighbours lie inside it)
  for (let x = 0; x < W; x++) { x0[x] = Math.min(cw - 1, Math.max(0, x0[x] - bx0)); x1[x] = Math.min(cw - 1, Math.max(0, x1[x] - bx0)); }
  for (let y = 0; y < H; y++) { y0[y] = Math.min(ch - 1, Math.max(0, y0[y] - by0)); y1[y] = Math.min(ch - 1, Math.max(0, y1[y] - by0)); }
  const [aR, aG, aB] = g.a, gb = g.b;
  for (let y = 0, i = 0; y < H; y++) {
    const row = yb[y] * w, r0 = y0[y] * cw, r1 = y1[y] * cw, ay = fy[y];
    for (let x = 0; x < W; x++, i++) {
      const c = cls[row + xb[x]];
      if (c) { out[i] = c === 1 ? 255 : 0; continue; }
      const ax = fx[x], k00 = r0 + x0[x], k01 = r0 + x1[x], k10 = r1 + x0[x], k11 = r1 + x1[x];
      const w00 = (1 - ax) * (1 - ay), w01 = ax * (1 - ay), w10 = (1 - ax) * ay, w11 = ax * ay;
      const j = i << 2, a = data[j + 3] / 255, wh = 1 - a, s8 = a / 255;
      const cr = aR[k00] * w00 + aR[k01] * w01 + aR[k10] * w10 + aR[k11] * w11;
      const cg = aG[k00] * w00 + aG[k01] * w01 + aG[k10] * w10 + aG[k11] * w11;
      const cb = aB[k00] * w00 + aB[k01] * w01 + aB[k10] * w10 + aB[k11] * w11;
      const c0 = gb[k00] * w00 + gb[k01] * w01 + gb[k10] * w10 + gb[k11] * w11;
      const v = cr * (data[j] * s8 + wh) + cg * (data[j + 1] * s8 + wh) + cb * (data[j + 2] * s8 + wh) + c0;
      const t = (v - 0.04) / 0.92;
      out[i] = Math.round(Math.min(1, Math.max(0, t)) * 255);
    }
  }
  return { width: W, height: H, data: out };
}
