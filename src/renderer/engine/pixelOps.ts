/** Raster helpers shared by photo tools and commands. */
import { apply, invert, multiply, translate, scale, type Matrix } from '../../core/geometry';
import { findNode, make, worldMatrix } from '../../core/document';
import { addNodes, updateNode } from '../../core/commands';
import { transformPath } from '../../core/path';
import type { QuvreloDocument, Id, PathCommand, RasterNode } from '../../core/types';
import type { Editor } from '../state/editor';
import { cloneCanvas, createCanvas, ctx2d } from './assets';
import { toPath2D } from './draw';

/** Matrix mapping document (world) coordinates to a raster node's pixel grid. */
export function worldToPixelMatrix(doc: QuvreloDocument, id: Id): Matrix | null {
  const loc = findNode(doc, id);
  if (!loc || loc.node.type !== 'raster') return null;
  const n = loc.node;
  return multiply(translate(n.w / 2, n.h / 2), invert(worldMatrix(loc)));
}

export function selectionInPixels(doc: QuvreloDocument, id: Id, sel: PathCommand[] | null): Path2D | null {
  if (!sel) return null;
  const m = worldToPixelMatrix(doc, id);
  if (!m) return null;
  return toPath2D(transformPath(sel, m));
}

/** Selected raster node in the active container (or null). */
export function activeRaster(ed: Editor): RasterNode | null {
  const sel = ed.selectedNodes();
  const r = sel.find((n) => n.type === 'raster');
  return (r as RasterNode) ?? null;
}

/** Create an empty full-page pixel layer, select it and return it. */
export function createPixelLayer(ed: Editor, name = 'Pixel Layer'): RasterNode | null {
  const doc = ed.doc;
  const container = ed.activeContainer;
  if (!doc || !container) return null;
  const W = Math.round(doc.settings.width);
  const H = Math.round(doc.settings.height);
  const canvas = createCanvas(W, H);
  const assetId = ed.assets.add(canvas, 'image/png');
  const node = make.raster({ assetId, w: W, h: H, x: W / 2, y: H / 2, name });
  // insert above the current selection
  const selIds = ed.ui.selection;
  const idx = selIds.length ? container.nodes.findIndex((n) => n.id === selIds[selIds.length - 1]) : -1;
  ed.commit('New pixel layer', (d) => {
    const withAsset = { ...d, assets: { ...d.assets, [assetId]: ed.assets.ref(assetId, name) } };
    return addNodes(withAsset, container.id, [node], idx >= 0 ? idx + 1 : undefined);
  });
  ed.select([node.id]);
  return node;
}

/** Replace a raster node's pixels with a new immutable asset. */
export function commitRasterCanvas(ed: Editor, nodeId: Id, canvas: HTMLCanvasElement, label: string): void {
  const assetId = ed.assets.add(canvas, 'image/png');
  ed.commit(label, (d) => {
    const loc = findNode(d, nodeId);
    const name = loc?.node.name ?? 'Pixel Layer';
    const withAsset = { ...d, assets: { ...d.assets, [assetId]: ed.assets.ref(assetId, name) } };
    return updateNode<RasterNode>(withAsset, nodeId, { assetId, w: canvas.width, h: canvas.height });
  });
}

/** Run a pixel edit on a copy of a raster layer, then commit it. */
export function editRaster(ed: Editor, nodeId: Id, label: string, fn: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, toPixel: Matrix) => void): boolean {
  const doc = ed.doc;
  if (!doc) return false;
  const loc = findNode(doc, nodeId);
  if (!loc || loc.node.type !== 'raster') return false;
  const base = ed.assets.get(loc.node.assetId);
  if (!base) return false;
  const work = cloneCanvas(base);
  const m = worldToPixelMatrix(doc, nodeId)!;
  // account for layers whose pixel size differs from their node size
  const sx = work.width / loc.node.w;
  const sy = work.height / loc.node.h;
  const toPixel = multiply(scale(sx, sy), m);
  fn(ctx2d(work), work, toPixel);
  commitRasterCanvas(ed, nodeId, work, label);
  return true;
}

export function pixelPoint(toPixel: Matrix, p: { x: number; y: number }) {
  return apply(toPixel, p);
}

/** Pre-rendered soft round dab for brushes. */
export function makeDab(diameter: number, hardness: number, color: string): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(diameter));
  const c = createCanvas(d + 2, d + 2);
  const ctx = ctx2d(c);
  const r = d / 2;
  const cx = c.width / 2;
  const g = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
  const h = Math.min(0.99, Math.max(0, hardness));
  g.addColorStop(0, color);
  g.addColorStop(h, color);
  g.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cx, r, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function colorWithAlpha(color: string, a: number): string {
  const c = parseColor(color);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

export function parseColor(color: string): { r: number; g: number; b: number; a: number } {
  const s = color.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
