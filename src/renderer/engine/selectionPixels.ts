/**
 * Pixel-selection helpers for Photo: rasterise the selection outline (with its
 * feather) into a layer's pixel grid, sample a layer or the whole page for the
 * magic wand / colour range, and turn coverage masks back into outlines.
 */
import { apply, invert, multiply, scale, type Matrix } from '../../core/geometry';
import { findNode } from '../../core/document';
import { transformPath } from '../../core/path';
import { booleanPaths } from '../../core/boolean';
import { maskToPath } from '../../core/ml/maskToPath';
import { binarize, type Mask } from '../../core/selectionMask';
import type { Id, PathCommand, QuvreloDocument, RasterNode } from '../../core/types';
import type { Editor } from '../state/editor';
import { createCanvas, ctx2d } from './assets';
import { toPath2D, drawPage } from './draw';
import { worldToPixelMatrix } from './pixelOps';

/** World -> layer pixel grid (accounts for pixel size differing from node size). */
export function layerPixelMatrix(doc: QuvreloDocument, n: RasterNode, pxW: number, pxH: number): Matrix | null {
  const m = worldToPixelMatrix(doc, n.id);
  if (!m) return null;
  return multiply(scale(pxW / n.w, pxH / n.h), m);
}

/** Layer pixels per document pixel along x (for feather / brush sizes). */
export function pixelScale(m: Matrix): number {
  const a = apply(m, { x: 0, y: 0 });
  const b = apply(m, { x: 1, y: 0 });
  return Math.hypot(b.x - a.x, b.y - a.y) || 1;
}

/**
 * Canvas (w x h) whose alpha is the selection coverage in a layer's pixel
 * grid, feathered. Null when there is no selection.
 */
export function selectionCanvas(sel: PathCommand[] | null, feather: number, toPx: Matrix, w: number, h: number): HTMLCanvasElement | null {
  if (!sel) return null;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const f = feather * pixelScale(toPx);
  if (f > 0.25) ctx.filter = `blur(${(f / 2).toFixed(2)}px)`;
  ctx.fillStyle = '#ffffff';
  ctx.fill(toPath2D(transformPath(sel, toPx)), 'evenodd');
  return c;
}

/** Selection coverage (0..255 per pixel) in a layer's grid, or null. */
export function selectionCoverage(sel: PathCommand[] | null, feather: number, toPx: Matrix, w: number, h: number): Uint8ClampedArray | null {
  const c = selectionCanvas(sel, feather, toPx, w, h);
  if (!c) return null;
  const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/** Editor-level shortcut: the current selection as a coverage canvas for a raster layer's own pixels. */
export function selectionCanvasFor(ed: Editor, nodeId: Id, w: number, h: number): HTMLCanvasElement | null {
  const doc = ed.doc;
  const sel = ed.ui.pixelSelection;
  if (!doc || !sel) return null;
  const loc = findNode(doc, nodeId);
  if (!loc || !('w' in loc.node)) return null;
  const n = loc.node as RasterNode;
  const m = layerPixelMatrix(doc, n, w, h);
  return m ? selectionCanvas(sel, ed.ui.pixelSelectionFeather, m, w, h) : null;
}

/**
 * Replace `base` by `edited` inside the selection coverage (soft edges blend):
 * out = base * (1 - m) + edited * m, in premultiplied space.
 */
export function blendThroughSelection(base: HTMLCanvasElement, edited: HTMLCanvasElement, cover: HTMLCanvasElement | null): HTMLCanvasElement {
  if (!cover) return edited;
  const out = createCanvas(base.width, base.height);
  const o = ctx2d(out);
  o.drawImage(base, 0, 0);
  o.globalCompositeOperation = 'destination-out';
  o.drawImage(cover, 0, 0);
  const e = createCanvas(base.width, base.height);
  const ex = ctx2d(e);
  ex.drawImage(edited, 0, 0);
  ex.globalCompositeOperation = 'destination-in';
  ex.drawImage(cover, 0, 0);
  o.globalCompositeOperation = 'lighter';
  o.drawImage(e, 0, 0);
  return out;
}

export interface SampleView {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** sample pixel -> world */
  toWorld: Matrix;
  /** world -> sample pixel */
  toPixel: Matrix;
}

const MAX_SAMPLE = 4096;

/** A layer's rendered pixels (adjustments applied) for sampling, at up to 4096 px a side. */
export function layerSample(ed: Editor, n: RasterNode): SampleView | null {
  const doc = ed.doc;
  const src = doc ? ed.assets.rendered(n.assetId, n.adjustments, false) : null;
  if (!doc || !src) return null;
  const k = Math.min(1, MAX_SAMPLE / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * k));
  const height = Math.max(1, Math.round(src.height * k));
  const c = createCanvas(width, height);
  const ctx = ctx2d(c);
  ctx.drawImage(src, 0, 0, width, height);
  const toPixel = layerPixelMatrix(doc, n, width, height);
  if (!toPixel) return null;
  return { width, height, data: ctx.getImageData(0, 0, width, height).data, toPixel, toWorld: invert(toPixel) };
}

/** Every visible layer of the page, composited, in document pixels (capped at 4096 a side). */
export function pageSample(ed: Editor): SampleView | null {
  const doc = ed.doc;
  if (!doc) return null;
  const W = doc.settings.width;
  const H = doc.settings.height;
  const k = Math.min(1, MAX_SAMPLE / Math.max(W, H));
  const width = Math.max(1, Math.round(W * k));
  const height = Math.max(1, Math.round(H * k));
  const c = createCanvas(width, height);
  const ctx = ctx2d(c);
  ctx.scale(width / W, height / H);
  drawPage(ctx, doc, Math.max(0, ed.activePageIndex), { doc, assets: ed.assets, editor: false, preview: false, zoom: width / W });
  const toPixel = scale(width / W, height / H);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data, toPixel, toWorld: invert(toPixel) };
}

/** Coverage mask (sample grid) -> world-space outline, or null when nothing is covered. */
export function maskToWorldPath(mask: Mask | Uint8Array, view: SampleView, threshold = 128): PathCommand[] | null {
  const bin = mask instanceof Uint8Array && !(mask instanceof Uint8ClampedArray) ? mask : binarize(mask as Mask, threshold);
  const d = maskToPath(bin, view.width, view.height, { epsilon: 0.5, minArea: 1 });
  return d ? transformPath(d, view.toWorld) : null;
}

/** Rasterise the current selection outline into a sample grid (0/255, no feather). */
export function selectionToMask(sel: PathCommand[], view: SampleView): Mask {
  const c = createCanvas(view.width, view.height);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  ctx.fill(toPath2D(transformPath(sel, view.toPixel)), 'evenodd');
  const d = ctx.getImageData(0, 0, view.width, view.height).data;
  const out = new Uint8ClampedArray(view.width * view.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

/** Combine a new outline with the current selection (Boolean ops on outlines). */
export function combineSelection(cur: PathCommand[] | null, next: PathCommand[] | null, mode: SelectionMode): PathCommand[] | null {
  if (mode === 'new') return next;
  if (!cur) return mode === 'add' ? next : null;
  if (!next) return mode === 'intersect' ? null : cur;
  return booleanPaths([cur, next], mode)[0] ?? null;
}
