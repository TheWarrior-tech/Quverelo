/**
 * Layer compositing beyond what a plain canvas draw gives (Photo parity):
 *
 * - isolated layers: groups with opacity < 100 % or a blend mode composite
 *   their children first (pass-through otherwise, like Photoshop's default),
 * - pixel (greyscale) layer masks,
 * - clipping masks (a run of `clipped` layers drawn inside the alpha of the
 *   nearest unclipped layer below),
 * - adjustment layers (read back what is below, adjust, write it back),
 * - blend modes canvas 2D has no operator for (core/blend.ts, per pixel).
 *
 * All work happens in device pixels of the target context (viewport, export
 * canvas or thumbnail), so it is exact at any zoom.
 */
import { applyAdjustment } from '../../core/pixels';
import { compositeBuffers, isNativeBlend } from '../../core/blend';
import type { AdjustmentNode, BlendMode, Id, QuvreloDocument, SceneNode } from '../../core/types';
import type { DrawEnv } from './draw';

export interface DeviceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Ctx = CanvasRenderingContext2D;
type DrawFn = (ctx: Ctx, n: SceneNode, env: DrawEnv) => void;

// ---------------------------------------------------------------------------
// Offscreen pool

const pool: HTMLCanvasElement[] = [];

function acquire(w: number, h: number): { c: HTMLCanvasElement; x: Ctx } {
  const c = pool.pop() ?? document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const x = c.getContext('2d')!;
  (x as Ctx & { reset?: () => void }).reset?.();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, w, h);
  return { c, x };
}

function release(c: HTMLCanvasElement): void {
  if (pool.length < 8) pool.push(c);
}

// ---------------------------------------------------------------------------
// Geometry

/** Device-pixel bounds of a local rectangle under the context's current transform, clipped to the canvas. */
export function deviceRect(ctx: Ctx, b: { x: number; y: number; w: number; h: number }, pad = 2): DeviceRect | null {
  const t = ctx.getTransform();
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs) + pad));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys) + pad));
  if (!isFinite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const fullRect = (ctx: Ctx): DeviceRect => ({ x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height });

function union(a: DeviceRect | null, b: DeviceRect | null): DeviceRect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ---------------------------------------------------------------------------
// Which nodes need their own layer

/** Does drawing this node need an offscreen layer (vs a direct draw with globalAlpha / composite op)? */
export function needsLayer(n: SceneNode): boolean {
  if (n.type === 'adjustment') return false; // composites itself (reads what is below)
  if (n.pixelMask?.enabled) return true;
  if (!isNativeBlend(n.blend)) return true;
  if (n.type === 'group') return n.opacity < 1 || n.blend !== 'normal';
  return false;
}

/**
 * Composite `src` (device pixels, same size as dst's canvas) onto `dst` with
 * opacity and a blend mode, inside `r`. Respects dst's current clip.
 */
export function compositeOnto(dst: Ctx, src: HTMLCanvasElement, r: DeviceRect, opacity: number, blend: BlendMode): void {
  if (r.w <= 0 || r.h <= 0 || opacity <= 0) return;
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  if (isNativeBlend(blend)) {
    dst.globalAlpha = opacity;
    dst.globalCompositeOperation = blend === 'normal' ? 'source-over' : (blend as GlobalCompositeOperation);
    dst.drawImage(src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  } else {
    const below = dst.getImageData(r.x, r.y, r.w, r.h);
    const top = src.getContext('2d')!.getImageData(r.x, r.y, r.w, r.h);
    compositeBuffers(below.data, top.data, blend, opacity);
    const t = acquire(r.w, r.h);
    t.x.putImageData(below, 0, 0);
    dst.beginPath();
    dst.rect(r.x, r.y, r.w, r.h);
    dst.clip();
    dst.globalAlpha = 1;
    dst.globalCompositeOperation = 'copy';
    dst.drawImage(t.c, r.x, r.y);
    release(t.c);
  }
  dst.restore();
}

/** Multiply an offscreen layer (drawn in the node's local space) by the node's pixel mask. */
function applyPixelMask(x: Ctx, n: SceneNode, env: DrawEnv): void {
  const pm = n.pixelMask;
  if (!pm?.enabled || !('w' in n) || !('h' in n)) return;
  const m = env.livePaint?.mask && env.livePaint.nodeId === n.id ? env.livePaint.canvas : env.assets.get(pm.assetId);
  if (!m) return;
  x.save();
  x.globalAlpha = 1;
  x.globalCompositeOperation = pm.inverted ? 'destination-out' : 'destination-in';
  x.imageSmoothingEnabled = true;
  x.drawImage(m, -n.w / 2, -n.h / 2, n.w, n.h);
  x.restore();
}

/**
 * Draw a node through its own layer. `ctx` holds the node's local transform;
 * `opacity` is the full effective opacity (the caller has not applied it).
 */
export function drawLayered(ctx: Ctx, n: SceneNode, env: DrawEnv, opacity: number, blend: BlendMode, content: (x: Ctx) => void, localBounds?: { x: number; y: number; w: number; h: number }): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const r = localBounds ? deviceRect(ctx, localBounds, 4 + ('stroke' in n ? (n.stroke.width || 0) * Math.hypot(ctx.getTransform().a, ctx.getTransform().b) : 0)) : fullRect(ctx);
  if (!r) return;
  const off = acquire(W, H);
  off.x.setTransform(ctx.getTransform());
  content(off.x);
  applyPixelMask(off.x, n, env);
  compositeOnto(ctx, off.c, r, opacity, blend);
  release(off.c);
}

// ---------------------------------------------------------------------------
// Clipping masks

export interface ClipInfo {
  /** layers clipped to this one (bottom first) */
  followers?: SceneNode[];
  /** drawn by its clip base, not on its own */
  follower?: boolean;
}

const clipCache = new WeakMap<QuvreloDocument, Map<Id, ClipInfo>>();

/** Clip-run structure of every container (and group) in a document. */
export function clipInfo(doc: QuvreloDocument): Map<Id, ClipInfo> {
  let m = clipCache.get(doc);
  if (m) return m;
  m = new Map();
  const visit = (nodes: SceneNode[]) => {
    for (const run of clipRuns(nodes)) {
      if (run.followers.length) {
        m!.set(run.base.id, { followers: run.followers });
        for (const f of run.followers) m!.set(f.id, { follower: true });
      }
    }
    for (const n of nodes) if (n.type === 'group') visit(n.children);
  };
  doc.pages.forEach((p) => visit(p.nodes));
  doc.masters.forEach((p) => visit(p.nodes));
  clipCache.set(doc, m);
  return m;
}

/** Split a stack (bottom first) into clip runs: a base and the clipped layers directly above it. */
export function clipRuns(nodes: SceneNode[]): { base: SceneNode; followers: SceneNode[] }[] {
  const out: { base: SceneNode; followers: SceneNode[] }[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.clipped && last) last.followers.push(n);
    else out.push({ base: n, followers: [] });
  }
  return out;
}

/** Draw a node stack (bottom first), honouring clipping masks. */
export function drawNodeList(ctx: Ctx, nodes: SceneNode[], env: DrawEnv, drawNode: DrawFn): void {
  for (const run of clipRuns(nodes)) {
    if (run.followers.length) drawClipGroup(ctx, run.base, run.followers, env, drawNode);
    else drawNode(ctx, run.base, env);
  }
}

/**
 * A clip run: the base, then each follower kept inside the base's alpha. The
 * base's opacity and blend apply to the whole run (Photoshop behaviour).
 * `ctx` is in the parent's space; `opacity` overrides the base opacity (fabric
 * has applied it to globalAlpha already at the top level).
 */
export function drawClipGroup(ctx: Ctx, base: SceneNode, followers: SceneNode[], env: DrawEnv, drawNode: DrawFn, opacity = base.opacity): void {
  if (!base.visible) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const T = ctx.getTransform();
  const r = fullRect(ctx);
  const a = acquire(W, H);
  a.x.setTransform(T);
  drawNode(a.x, { ...base, opacity: 1, blend: 'normal', clipped: false } as SceneNode, env);
  const alpha = acquire(W, H);
  alpha.x.drawImage(a.c, 0, 0);
  for (const f of followers) {
    if (!f.visible) continue;
    const b = acquire(W, H);
    if (f.type === 'adjustment') {
      // a clipped adjustment adjusts the run so far, inside the base
      b.x.drawImage(a.c, 0, 0);
      b.x.setTransform(T);
      drawNode(b.x, { ...f, clipped: false }, env);
      b.x.setTransform(1, 0, 0, 1, 0, 0);
      b.x.globalCompositeOperation = 'destination-in';
      b.x.drawImage(alpha.c, 0, 0);
      a.x.save();
      a.x.setTransform(1, 0, 0, 1, 0, 0);
      a.x.globalCompositeOperation = 'copy';
      a.x.drawImage(b.c, 0, 0);
      a.x.restore();
    } else {
      b.x.setTransform(T);
      drawNode(b.x, { ...f, opacity: 1, blend: 'normal', clipped: false } as SceneNode, env);
      b.x.setTransform(1, 0, 0, 1, 0, 0);
      b.x.globalCompositeOperation = 'destination-in';
      b.x.drawImage(alpha.c, 0, 0);
      a.x.save();
      a.x.setTransform(1, 0, 0, 1, 0, 0);
      compositeOnto(a.x, b.c, r, f.opacity, f.blend);
      a.x.restore();
    }
    release(b.c);
  }
  compositeOnto(ctx, a.c, r, opacity, base.blend);
  release(alpha.c);
  release(a.c);
}

// ---------------------------------------------------------------------------
// Adjustment layers

/**
 * Adjust what is already drawn under an adjustment layer's box. `ctx` holds
 * the node's local transform, and the caller has set globalAlpha (opacity) and
 * the composite op (native blends).
 */
export function drawAdjustmentLayer(ctx: Ctx, n: AdjustmentNode, env: DrawEnv): void {
  if (!n.adjustment.enabled) return;
  const box = { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
  const r = deviceRect(ctx, box, 0);
  if (!r) return;
  const t = ctx.getTransform();
  const scale = Math.hypot(t.a, t.b) || 1;
  const below = ctx.getImageData(r.x, r.y, r.w, r.h);
  const adjusted = applyAdjustment({ width: r.w, height: r.h, data: below.data }, n.adjustment, scale);
  const tmp = acquire(r.w, r.h);
  const img = tmp.x.createImageData(r.w, r.h);
  img.data.set(adjusted.data);
  tmp.x.putImageData(img, 0, 0);
  // keep only the node's box (and pixel mask), drawn in local space relative to r
  tmp.x.setTransform(t.a, t.b, t.c, t.d, t.e - r.x, t.f - r.y);
  tmp.x.globalCompositeOperation = 'destination-in';
  tmp.x.fillRect(box.x, box.y, box.w, box.h);
  tmp.x.globalCompositeOperation = 'source-over';
  applyPixelMask(tmp.x, n, env);
  tmp.x.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (isNativeBlend(n.blend)) {
    ctx.drawImage(tmp.c, r.x, r.y);
  } else {
    const opacity = ctx.globalAlpha;
    const top = tmp.x.getImageData(0, 0, r.w, r.h);
    const fresh = ctx.getImageData(r.x, r.y, r.w, r.h);
    compositeBuffers(fresh.data, top.data, n.blend, opacity);
    tmp.x.putImageData(fresh, 0, 0);
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(tmp.c, r.x, r.y);
  }
  ctx.restore();
  release(tmp.c);
}

export { union as unionDeviceRects };
