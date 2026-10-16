/**
 * Pixel-selection helpers for Photo: rasterise the selection outline (with its
 * feather) into a layer's pixel grid, sample a layer or the whole page for the
 * magic wand / colour range, and turn coverage masks back into outlines.
 *
 * Soft selections: a selection made from a coverage mask (Select colour range,
 * Refine edge, mask to selection, Invert / add / subtract on one of those)
 * keeps its per-pixel alpha. The mask is attached to the outline array that
 * sits in `ui.pixelSelection` (the outline is its 50 % threshold, which is
 * what the marching ants show), so every consumer that rasterises the
 * selection gets the partial pixels, and any code that puts a different
 * outline in the selection drops the mask automatically.
 */
import { apply, invert, multiply, scale, type Matrix } from '../../core/geometry';
import { findNode } from '../../core/document';
import { transformPath } from '../../core/path';
import { booleanPaths } from '../../core/boolean';
import { maskToPath } from '../../core/ml/maskToPath';
import { binarize, combineMasks, invertMask, type Mask, type MaskOp } from '../../core/selectionMask';
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

/** A per-pixel selection: coverage in its own grid, and world -> grid. */
export interface SoftMask {
  width: number;
  height: number;
  data: Mask;
  toPixel: Matrix;
}

const softMasks = new WeakMap<PathCommand[], SoftMask>();
const softCanvases = new WeakMap<SoftMask, HTMLCanvasElement>();

/** The soft mask behind a selection outline, or null for a plain (hard / uniformly feathered) one. */
export function softSelection(sel: PathCommand[] | null | undefined): SoftMask | null {
  return (sel && softMasks.get(sel)) || null;
}

/**
 * A selection from a coverage mask: the outline traced at 50 % (marching
 * ants), with the mask attached so partial pixels stay partial. A mask with
 * only faint coverage (nothing at 50 %) is traced at its lowest level so it
 * still shows an outline. Null when nothing is covered.
 */
export function softSelectionFrom(mask: Mask, view: Pick<SampleView, 'width' | 'height' | 'toPixel' | 'toWorld'>): PathCommand[] | null {
  let max = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > max) max = mask[i];
  if (max === 0) return null;
  const d = maskToWorldPath(mask, view as SampleView, max >= 128 ? 128 : 1);
  if (!d) return null;
  // a fully hard mask needs no attachment: the outline says it all
  let soft = false;
  for (let i = 0; i < mask.length && !soft; i++) soft = mask[i] > 0 && mask[i] < 255;
  if (soft) softMasks.set(d, { width: view.width, height: view.height, data: mask, toPixel: view.toPixel });
  return d;
}

/** Canvas whose alpha is a soft mask, in the mask's own grid (cached per mask). */
function softCanvas(m: SoftMask): HTMLCanvasElement {
  let c = softCanvases.get(m);
  if (c) return c;
  c = createCanvas(m.width, m.height);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(m.width, m.height);
  for (let i = 0; i < m.data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = m.data[i];
  }
  ctx.putImageData(img, 0, 0);
  softCanvases.set(m, c);
  return c;
}

/**
 * Canvas (w x h) whose alpha is the selection coverage in a layer's pixel
 * grid, feathered. Soft selections keep their partial pixels. Null when there
 * is no selection.
 */
export function selectionCanvas(sel: PathCommand[] | null, feather: number, toPx: Matrix, w: number, h: number): HTMLCanvasElement | null {
  if (!sel) return null;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const f = feather * pixelScale(toPx);
  if (f > 0.25) ctx.filter = `blur(${(f / 2).toFixed(2)}px)`;
  const soft = softSelection(sel);
  if (soft) {
    // mask grid -> world -> this grid
    ctx.setTransform(...multiply(toPx, invert(soft.toPixel)));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(softCanvas(soft), 0, 0);
    return c;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fill(toPath2D(transformPath(sel, toPx)), 'evenodd');
  return c;
}

/** Invert a selection inside the page box (soft selections invert per pixel). */
export function invertSelection(sel: PathCommand[], page: PathCommand[], view: Pick<SampleView, 'width' | 'height' | 'toPixel' | 'toWorld'>): PathCommand[] | null {
  const soft = softSelection(sel);
  if (!soft) return booleanPaths([page, sel], 'subtract')[0] ?? null;
  return softSelectionFrom(invertMask(selectionToMask(sel, view as SampleView)), view);
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

/** Page grid (document pixels, capped at 2048 a side) for rasterising selections. */
export function pageGridView(doc: QuvreloDocument): SampleView {
  const k = Math.min(1, 2048 / Math.max(doc.settings.width, doc.settings.height));
  const width = Math.max(1, Math.round(doc.settings.width * k));
  const height = Math.max(1, Math.round(doc.settings.height * k));
  return { width, height, data: new Uint8ClampedArray(0), toPixel: scale(k, k), toWorld: scale(1 / k, 1 / k) };
}

/** Coverage mask (sample grid) -> world-space outline, or null when nothing is covered. */
export function maskToWorldPath(mask: Mask | Uint8Array, view: SampleView, threshold = 128): PathCommand[] | null {
  const bin = mask instanceof Uint8Array && !(mask instanceof Uint8ClampedArray) ? mask : binarize(mask as Mask, threshold);
  const d = maskToPath(bin, view.width, view.height, { epsilon: 0.5, minArea: 1 });
  return d ? transformPath(d, view.toWorld) : null;
}

/** Rasterise the current selection into a sample grid (0/255 for an outline, partial for a soft selection; no feather). */
export function selectionToMask(sel: PathCommand[], view: Pick<SampleView, 'width' | 'height' | 'toPixel'>): Mask {
  const c = selectionCanvas(sel, 0, view.toPixel, view.width, view.height)!;
  const ctx = ctx2d(c);
  const d = ctx.getImageData(0, 0, view.width, view.height).data;
  const out = new Uint8ClampedArray(view.width * view.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';

/**
 * Combine a new outline with the current selection (Boolean ops on outlines;
 * per pixel in the soft mask's grid when the current selection is soft).
 */
export function combineSelection(cur: PathCommand[] | null, next: PathCommand[] | null, mode: SelectionMode): PathCommand[] | null {
  if (mode === 'new') return next;
  const soft = softSelection(cur);
  if (soft && cur) {
    const view = { width: soft.width, height: soft.height, toPixel: soft.toPixel, toWorld: invert(soft.toPixel) };
    const b = next ? selectionToMask(next, view) : new Uint8ClampedArray(soft.width * soft.height);
    return softSelectionFrom(combineMasks(soft.data, b, mode as MaskOp), view);
  }
  if (!cur) return mode === 'add' ? next : null;
  if (!next) return mode === 'intersect' ? null : cur;
  return booleanPaths([cur, next], mode)[0] ?? null;
}
