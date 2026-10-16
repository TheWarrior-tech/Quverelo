/**
 * Binary mask -> closed polygon path (pixel coordinates), for turning an ML mask into a
 * Photo-studio pixel selection. Boundaries follow pixel edges ("crack following"), are chained into
 * loops, then simplified with Ramer-Douglas-Peucker. Holes come out as separate loops; render/fill
 * with the even-odd rule (which the selection system already uses).
 */
import type { Point } from '../geometry';
import type { PathCommand } from '../types';

/**
 * Trace every boundary loop of a 0/1 mask. Coordinates are pixel corners (0..w, 0..h).
 * A corner has at most two outgoing boundary edges (two at a diagonal "saddle"), so the edge lists are two typed
 * slots per corner, used as a stack (last added edge is followed first), and corners are visited in the order their
 * first edge was added.
 */
export function traceMaskLoops(bin: Uint8Array, w: number, h: number): Point[][] {
  const W1 = w + 1;
  const nv = W1 * (h + 1);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && bin[y * w + x] !== 0;
  // directed edges, inside on the right (clockwise in y-down screen space)
  const e0 = new Int32Array(nv), e1 = new Int32Array(nv), cnt = new Uint8Array(nv);
  let order = new Int32Array(1024), nOrder = 0;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const a = y0 * W1 + x0, b = y1 * W1 + x1;
    const c = cnt[a];
    if (c === 0) {
      if (nOrder === order.length) { const o = new Int32Array(order.length * 2); o.set(order); order = o; }
      order[nOrder++] = a; e0[a] = b;
    } else e1[a] = b;
    cnt[a] = c + 1;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: Point[][] = [];
  for (let k = 0; k < nOrder; k++) {
    const start = order[k];
    while (cnt[start] > 0) {
      const loop: Point[] = [];
      let v = start;
      let guard = 0;
      do {
        loop.push({ x: v % W1, y: Math.floor(v / W1) });
        const c = cnt[v];
        const nxt = c === 2 ? e1[v] : e0[v];
        cnt[v] = c - 1;
        v = nxt;
        if (++guard > 4 * nv) break;
      } while (v !== start && cnt[v] > 0);
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function dropCollinear(pts: Point[]): Point[] {
  const n = pts.length;
  const res: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) res.push(b);
  }
  return res.length >= 3 ? res : pts;
}

function rdp(pts: Point[], eps: number): Point[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let idx = -1;
  let dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
    const dd = len === 1 && dx === 0 && dy === 0 ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y) : d;
    if (dd > dmax) {
      dmax = dd;
      idx = i;
    }
  }
  if (dmax <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** Simplify a closed loop; keeps at least a triangle. */
export function simplifyLoop(loop: Point[], eps = 0.75): Point[] {
  const pts = dropCollinear(loop);
  if (pts.length <= 4 || eps <= 0) return pts;
  // split the ring at the point farthest from the first so RDP has two stable anchors
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  const res = a.slice(0, -1).concat(b.slice(0, -1));
  return res.length >= 3 ? res : pts;
}

/** Signed area (positive = clockwise in y-down space). */
export function loopArea(loop: Point[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Mask -> PathCommand[] in pixel coordinates. Loops whose |area| is below `minArea` px² are dropped
 * (speckle). Returns null for an empty mask.
 */
export function maskToPath(bin: Uint8Array, w: number, h: number, opts: { epsilon?: number; minArea?: number } = {}): PathCommand[] | null {
  const eps = opts.epsilon ?? 0.75;
  const minArea = opts.minArea ?? 4;
  const d: PathCommand[] = [];
  for (const loop of traceMaskLoops(bin, w, h)) {
    if (Math.abs(loopArea(loop)) < minArea) continue;
    const s = simplifyLoop(loop, eps);
    d.push(['M', s[0].x, s[0].y]);
    for (let i = 1; i < s.length; i++) d.push(['L', s[i].x, s[i].y]);
    d.push(['Z']);
  }
  return d.length ? d : null;
}
