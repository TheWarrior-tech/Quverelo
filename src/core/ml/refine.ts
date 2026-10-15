/**
 * Edge-aware refinement of a click-to-select result (pure TS, no DOM, unit-tested).
 *
 * Why: QuvSelect v0 is a small, undertrained network (click@1 mIoU 0.39, see ml/MODEL_CARD.md).
 * On a small object it localises the click well but returns a soft blob whose size follows the
 * click Gaussian, not the object's edges (critique 3, N0: a click on the cottage selected ~6x
 * the house). The model output is therefore used as a *prior* and the final mask is cut along
 * image edges with a GrabCut-style energy:
 *
 *   E(L) = sum_p [ -log p(c_p | GMM_L) - w log P_L(p) ] + gamma * sum_pq [L_p != L_q] exp(-beta |c_p - c_q|^2) / dist(p, q)
 *
 *  - P is the model probability (P_fg = P, P_bg = 1 - P), so the network still decides *what* is
 *    selected; colour GMMs (5 full-covariance components per side, re-fitted each round) and the
 *    contrast-sensitive smoothness term decide *where the edge is*.
 *  - Positive clicks are hard foreground, negative clicks hard background. The work is done in a
 *    region of interest around the prior; its border is hard background unless it is the image edge.
 *  - The minimum cut is exact (Dinic max-flow on the 8-connected grid).
 */
import type { SelectionClick } from './clickMaps';
import type { RgbaImage } from './tensor';
import { labelComponents, resizePlane } from './tensor';

export interface RefineOptions {
  /** GrabCut rounds (re-fit colour models, re-cut) */
  iterations?: number;
  /** weight of the model prior in the unary term */
  priorWeight?: number;
  /** smoothness weight (gamma) */
  smoothness?: number;
  /** colour components per side */
  components?: number;
  /** ROI margin as a fraction of the prior's bbox size (min 8 px) */
  margin?: number;
  /** pixels with prior >= seedThreshold form the seed region */
  seedThreshold?: number;
  /** the cut runs on a box-downsampled grid when the ROI exceeds this many pixels (cost guard) */
  maxPixels?: number;
}

const DEFAULTS: Required<RefineOptions> = {
  iterations: 4,
  priorWeight: 1,
  smoothness: 50,
  components: 5,
  margin: 0.25,
  seedThreshold: 0.5,
  maxPixels: 40_000,
};

// ---------------------------------------------------------------------------
// Gaussian mixture (RGB, full covariance), k-means++-style init

interface Gauss {
  w: number;
  mean: [number, number, number];
  inv: number[]; // 3x3 row-major inverse covariance
  logNorm: number; // log(w) - 0.5 log det(2 pi Sigma)
}

class Gmm {
  comps: Gauss[] = [];

  static fit(col: Float32Array, idx: Int32Array, n: number, k: number, seed = 1): Gmm {
    const g = new Gmm();
    if (n === 0) return g;
    // subsample for speed (deterministic stride)
    const stride = Math.max(1, Math.floor(n / 6000));
    const pts: number[] = [];
    for (let i = 0; i < n; i += stride) pts.push(idx[i]);
    const m = pts.length;
    k = Math.max(1, Math.min(k, m));
    // farthest-point init (deterministic)
    const centres: number[][] = [];
    let rnd = seed;
    const first = pts[(rnd = (rnd * 16807) % 2147483647) % m];
    centres.push([col[first * 3], col[first * 3 + 1], col[first * 3 + 2]]);
    const d2 = new Float64Array(m).fill(Infinity);
    while (centres.length < k) {
      const c = centres[centres.length - 1];
      let best = -1;
      let bestD = -1;
      for (let i = 0; i < m; i++) {
        const p = pts[i] * 3;
        const d = (col[p] - c[0]) ** 2 + (col[p + 1] - c[1]) ** 2 + (col[p + 2] - c[2]) ** 2;
        if (d < d2[i]) d2[i] = d;
        if (d2[i] > bestD) {
          bestD = d2[i];
          best = i;
        }
      }
      if (bestD <= 1e-9) break;
      const p = pts[best] * 3;
      centres.push([col[p], col[p + 1], col[p + 2]]);
    }
    k = centres.length;
    const assign = new Int32Array(m);
    for (let iter = 0; iter < 6; iter++) {
      const sum = new Float64Array(k * 3);
      const cnt = new Float64Array(k);
      for (let i = 0; i < m; i++) {
        const p = pts[i] * 3;
        let bj = 0;
        let bd = Infinity;
        for (let j = 0; j < k; j++) {
          const c = centres[j];
          const d = (col[p] - c[0]) ** 2 + (col[p + 1] - c[1]) ** 2 + (col[p + 2] - c[2]) ** 2;
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        assign[i] = bj;
        cnt[bj]++;
        sum[bj * 3] += col[p];
        sum[bj * 3 + 1] += col[p + 1];
        sum[bj * 3 + 2] += col[p + 2];
      }
      for (let j = 0; j < k; j++) if (cnt[j]) centres[j] = [sum[j * 3] / cnt[j], sum[j * 3 + 1] / cnt[j], sum[j * 3 + 2] / cnt[j]];
    }
    // covariances
    for (let j = 0; j < k; j++) {
      const mu = centres[j];
      const c = new Float64Array(9);
      let cn = 0;
      for (let i = 0; i < m; i++) {
        if (assign[i] !== j) continue;
        const p = pts[i] * 3;
        const d = [col[p] - mu[0], col[p + 1] - mu[1], col[p + 2] - mu[2]];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) c[a * 3 + b] += d[a] * d[b];
        cn++;
      }
      if (!cn) continue;
      for (let a = 0; a < 9; a++) c[a] /= cn;
      for (let a = 0; a < 3; a++) c[a * 4] += 1e-4; // regularise (colours are 0..1)
      const det =
        c[0] * (c[4] * c[8] - c[5] * c[7]) - c[1] * (c[3] * c[8] - c[5] * c[6]) + c[2] * (c[3] * c[7] - c[4] * c[6]);
      if (!(det > 0)) continue;
      const inv = [
        (c[4] * c[8] - c[5] * c[7]) / det,
        (c[2] * c[7] - c[1] * c[8]) / det,
        (c[1] * c[5] - c[2] * c[4]) / det,
        (c[5] * c[6] - c[3] * c[8]) / det,
        (c[0] * c[8] - c[2] * c[6]) / det,
        (c[2] * c[3] - c[0] * c[5]) / det,
        (c[3] * c[7] - c[4] * c[6]) / det,
        (c[1] * c[6] - c[0] * c[7]) / det,
        (c[0] * c[4] - c[1] * c[3]) / det,
      ];
      const w = cn / m;
      g.comps.push({ w, mean: [mu[0], mu[1], mu[2]], inv, logNorm: Math.log(w) - 0.5 * Math.log(det * (2 * Math.PI) ** 3) });
    }
    return g;
  }

  /** -log p(c) */
  nll(r: number, gr: number, b: number): number {
    let best = -Infinity;
    const ls: number[] = [];
    for (const c of this.comps) {
      const d0 = r - c.mean[0];
      const d1 = gr - c.mean[1];
      const d2 = b - c.mean[2];
      const i = c.inv;
      const q = d0 * (i[0] * d0 + i[1] * d1 + i[2] * d2) + d1 * (i[3] * d0 + i[4] * d1 + i[5] * d2) + d2 * (i[6] * d0 + i[7] * d1 + i[8] * d2);
      const l = c.logNorm - 0.5 * q;
      ls.push(l);
      if (l > best) best = l;
    }
    if (!ls.length) return 0;
    let s = 0;
    for (const l of ls) s += Math.exp(l - best);
    return -(best + Math.log(s));
  }
}

// ---------------------------------------------------------------------------
// Dinic max-flow on a grid graph with terminal capacities

/**
 * Minimum s/t cut. Nodes 0..n-1 are pixels; capS[p] = cost of cutting p from the source
 * (= paying for label "background"), capT[p] = cost of cutting p from the sink (label "foreground").
 * Edges are undirected (u, v, w) pairs. Returns 1 for nodes on the source (foreground) side.
 */
export function minCut(n: number, capS: Float64Array, capT: Float64Array, eu: Int32Array, ev: Int32Array, ew: Float64Array): Uint8Array {
  const S = n;
  const T = n + 1;
  const N = n + 2;
  // arcs: each undirected edge -> 2 arcs (u->v cap w, v->u cap w), each terminal -> arc + reverse
  const m = eu.length * 2 + n * 4;
  const head = new Int32Array(N).fill(-1);
  const next = new Int32Array(m);
  const to = new Int32Array(m);
  const cap = new Float64Array(m);
  let e = 0;
  const add = (u: number, v: number, c1: number, c2: number) => {
    to[e] = v; cap[e] = c1; next[e] = head[u]; head[u] = e++;
    to[e] = u; cap[e] = c2; next[e] = head[v]; head[v] = e++;
  };
  // push trivial flow through s->p->t first (reduces work)
  for (let p = 0; p < n; p++) {
    const f = Math.min(capS[p], capT[p]);
    const cs = capS[p] - f;
    const ct = capT[p] - f;
    if (cs > 0) add(S, p, cs, 0);
    if (ct > 0) add(p, T, ct, 0);
  }
  for (let i = 0; i < eu.length; i++) add(eu[i], ev[i], ew[i], ew[i]);

  const level = new Int32Array(N);
  const it = new Int32Array(N);
  const queue = new Int32Array(N);
  const EPS = 1e-9;
  const bfs = (): boolean => {
    level.fill(-1);
    let qh = 0;
    let qt = 0;
    queue[qt++] = S;
    level[S] = 0;
    while (qh < qt) {
      const u = queue[qh++];
      for (let a = head[u]; a !== -1; a = next[a]) {
        if (cap[a] > EPS && level[to[a]] < 0) {
          level[to[a]] = level[u] + 1;
          queue[qt++] = to[a];
        }
      }
    }
    return level[T] >= 0;
  };
  // iterative DFS
  const stackNode = new Int32Array(N);
  const stackArc = new Int32Array(N);
  const dfs = (): number => {
    let total = 0;
    for (;;) {
      let sp = 0;
      let u = S;
      // find path
      let found = false;
      for (;;) {
        if (u === T) {
          found = true;
          break;
        }
        let a = it[u];
        while (a !== -1 && !(cap[a] > EPS && level[to[a]] === level[u] + 1)) a = next[a];
        it[u] = a;
        if (a === -1) {
          // dead end: retreat
          level[u] = -1;
          if (sp === 0) break;
          sp--;
          u = stackNode[sp];
          it[u] = next[it[u]];
          continue;
        }
        stackNode[sp] = u;
        stackArc[sp] = a;
        sp++;
        u = to[a];
      }
      if (!found) return total;
      let f = Infinity;
      for (let i = 0; i < sp; i++) f = Math.min(f, cap[stackArc[i]]);
      for (let i = 0; i < sp; i++) {
        cap[stackArc[i]] -= f;
        cap[stackArc[i] ^ 1] += f;
      }
      total += f;
    }
  };
  while (bfs()) {
    for (let i = 0; i < N; i++) it[i] = head[i];
    if (dfs() <= 0) break;
  }
  // source side = reachable from S in residual graph
  const side = new Uint8Array(n);
  const seen = new Uint8Array(N);
  let qh = 0;
  let qt = 0;
  queue[qt++] = S;
  seen[S] = 1;
  while (qh < qt) {
    const u = queue[qh++];
    for (let a = head[u]; a !== -1; a = next[a]) {
      const v = to[a];
      if (cap[a] > EPS && !seen[v]) {
        seen[v] = 1;
        queue[qt++] = v;
      }
    }
  }
  for (let p = 0; p < n; p++) side[p] = seen[p];
  return side;
}

// ---------------------------------------------------------------------------

export interface RefineResult {
  /** 0/1 mask at image resolution */
  binary: Uint8Array;
  /** ROI the cut ran in (image pixels) */
  roi: { x: number; y: number; w: number; h: number };
}

/**
 * Refine a model prior into a mask that follows image edges.
 * `prior` is the model probability (0..1) at image resolution. Returns null when there is nothing
 * to refine (no seed region at the clicks) or the ROI is too large; callers keep the model mask then.
 */
export function refineWithPrior(img: RgbaImage, prior: Float32Array, clicks: SelectionClick[], options: RefineOptions = {}): RefineResult | null {
  const o = { ...DEFAULTS, ...options };
  const { width: W, height: H, data } = img;
  const pos = clicks.filter((c) => c.positive);
  if (!pos.length) return null;

  // seed = prior components touching a positive click
  const seedBin = new Uint8Array(W * H);
  for (let i = 0; i < seedBin.length; i++) seedBin[i] = prior[i] >= o.seedThreshold ? 1 : 0;
  const { labels } = labelComponents(seedBin, W, H);
  const keep = new Set<number>();
  for (const c of pos) {
    const l = labels[Math.min(H - 1, Math.max(0, Math.round(c.y))) * W + Math.min(W - 1, Math.max(0, Math.round(c.x)))];
    if (l) keep.add(l);
  }
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < labels.length; i++) {
    if (!keep.has(labels[i])) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  for (const c of pos) {
    x0 = Math.min(x0, Math.floor(c.x));
    x1 = Math.max(x1, Math.ceil(c.x));
    y0 = Math.min(y0, Math.floor(c.y));
    y1 = Math.max(y1, Math.ceil(c.y));
  }
  const pad = Math.max(8, Math.round(o.margin * Math.max(x1 - x0 + 1, y1 - y0 + 1)));
  const rx = Math.max(0, x0 - pad);
  const ry = Math.max(0, y0 - pad);
  const rw = Math.min(W, x1 + pad + 1) - rx;
  const rh = Math.min(H, y1 + pad + 1) - ry;
  if (rw <= 0 || rh <= 0) return null;
  // work grid: the ROI, box-downsampled by f when it is large
  const f = Math.max(1, Math.ceil(Math.sqrt((rw * rh) / o.maxPixels)));
  const gw = Math.ceil(rw / f);
  const gh = Math.ceil(rh / f);
  const n = gw * gh;

  // colours (0..1) and prior on the grid
  const col = new Float32Array(n * 3);
  const P = new Float32Array(n);
  const cnt = new Float32Array(n);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const p = ((y / f) | 0) * gw + ((x / f) | 0);
      const s = (y + ry) * W + (x + rx);
      const a = data[s * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) col[p * 3 + c] += (data[s * 4 + c] * a + 255 * (1 - a)) / 255;
      P[p] += prior[s];
      cnt[p]++;
    }
  for (let p = 0; p < n; p++) {
    col[p * 3] /= cnt[p];
    col[p * 3 + 1] /= cnt[p];
    col[p * 3 + 2] /= cnt[p];
    P[p] /= cnt[p];
  }

  // hard constraints: 1 = fg, 2 = bg
  const hard = new Uint8Array(n);
  const disk = Math.max(1, Math.round(Math.max(2, 0.006 * Math.max(W, H)) / f));
  const stamp = (cx: number, cy: number, v: number) => {
    const gx = Math.floor((cx - rx) / f);
    const gy = Math.floor((cy - ry) / f);
    for (let dy = -disk; dy <= disk; dy++)
      for (let dx = -disk; dx <= disk; dx++) {
        if (dx * dx + dy * dy > disk * disk) continue;
        const x = gx + dx;
        const y = gy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh) hard[y * gw + x] = v;
      }
  };
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const border = (x === 0 && rx > 0) || (y === 0 && ry > 0) || (x === gw - 1 && rx + rw < W) || (y === gh - 1 && ry + rh < H);
      if (border) hard[y * gw + x] = 2;
    }
  for (const c of clicks) stamp(c.x, c.y, c.positive ? 1 : 2);

  // paigwise edges (8-connected), contrast-sensitive weights
  const nE = (gw - 1) * gh + gw * (gh - 1) + 2 * (gw - 1) * (gh - 1);
  const eu = new Int32Array(nE);
  const ev = new Int32Array(nE);
  const ed = new Float64Array(nE); // squared colour distance
  const ei = new Float64Array(nE); // 1/dist
  let k = 0;
  let sumD = 0;
  const push = (a: number, b: number, inv: number) => {
    const d = (col[a * 3] - col[b * 3]) ** 2 + (col[a * 3 + 1] - col[b * 3 + 1]) ** 2 + (col[a * 3 + 2] - col[b * 3 + 2]) ** 2;
    eu[k] = a; ev[k] = b; ed[k] = d; ei[k] = inv; k++;
    sumD += d;
  };
  const SQ = Math.SQRT1_2;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const p = y * gw + x;
      if (x + 1 < gw) push(p, p + 1, 1);
      if (y + 1 < gh) push(p, p + gw, 1);
      if (x + 1 < gw && y + 1 < gh) push(p, p + gw + 1, SQ);
      if (x > 0 && y + 1 < gh) push(p, p + gw - 1, SQ);
    }
  const beta = sumD > 0 ? 1 / (2 * (sumD / k)) : 0;
  const ew = new Float64Array(k);
  for (let i = 0; i < k; i++) ew[i] = o.smoothness * ei[i] * Math.exp(-beta * ed[i]);

  // initial labelling from the prior
  let fg: Uint8Array = new Uint8Array(n);
  for (let p = 0; p < n; p++) fg[p] = hard[p] === 1 ? 1 : hard[p] === 2 ? 0 : P[p] >= o.seedThreshold ? 1 : 0;

  const INF = 1e9;
  const LOGEPS = 1e-4;
  const idxF = new Int32Array(n);
  const idxB = new Int32Array(n);
  const capS = new Float64Array(n);
  const capT = new Float64Array(n);
  for (let round = 0; round < o.iterations; round++) {
    let nf = 0;
    let nb = 0;
    for (let p = 0; p < n; p++) {
      if (fg[p]) idxF[nf++] = p;
      else idxB[nb++] = p;
    }
    if (!nf || !nb) break;
    const gF = Gmm.fit(col, idxF, nf, o.components, 7);
    const gB = Gmm.fit(col, idxB, nb, o.components, 13);
    for (let p = 0; p < n; p++) {
      if (hard[p] === 1) {
        capS[p] = INF;
        capT[p] = 0;
        continue;
      }
      if (hard[p] === 2) {
        capS[p] = 0;
        capT[p] = INF;
        continue;
      }
      const r = col[p * 3];
      const g = col[p * 3 + 1];
      const b = col[p * 3 + 2];
      const pr = Math.min(1 - LOGEPS, Math.max(LOGEPS, P[p]));
      const dF = gF.nll(r, g, b) - o.priorWeight * Math.log(pr);
      const dB = gB.nll(r, g, b) - o.priorWeight * Math.log(1 - pr);
      // shift so both are >= 0 (only the difference matters)
      const mn = Math.min(dF, dB);
      capS[p] = dB - mn; // cutting from source = labelled background
      capT[p] = dF - mn; // cutting from sink = labelled foreground
    }
    const next = minCut(n, capS, capT, eu.subarray(0, k), ev.subarray(0, k), ew);
    let changed = 0;
    for (let p = 0; p < n; p++) if (next[p] !== fg[p]) changed++;
    fg = next;
    if (changed < n * 0.001) break;
  }

  const binary = new Uint8Array(W * H);
  if (f === 1) {
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) binary[(y + ry) * W + x + rx] = fg[y * rw + x];
  } else {
    // bilinear upsample of the grid labels, thresholded at 0.5 (smooth edges, not blocks)
    const g = new Float32Array(n);
    for (let p = 0; p < n; p++) g[p] = fg[p];
    const up = resizePlane(g, gw, gh, gw * f, gh * f);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) binary[(y + ry) * W + x + rx] = up[y * gw * f + x] >= 0.5 ? 1 : 0;
  }
  return { binary, roi: { x: rx, y: ry, w: rw, h: rh } };
}
