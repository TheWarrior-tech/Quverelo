/**
 * Document-level Photo operations that need pixels: image size with a
 * resampling method, canvas size with an anchor, straighten, and the pixel
 * layer-mask helpers (add from selection, apply, load as selection).
 */
import { apply, invert, multiply, scale, translate, type Matrix } from '../../core/geometry';
import { findNode, worldMatrix } from '../../core/document';
import { resizeDocument, updateNode } from '../../core/commands';
import { resample, anchorOffset, type Anchor, type ResampleMethod } from '../../core/resample';
import type { Id, PixelMask, QuvreloDocument, RasterNode, SceneNode } from '../../core/types';
import type { AssetStore } from './assets';
import { canvasToPixels, createCanvas, ctx2d, pixelsToCanvas } from './assets';
import { selectionCanvas } from './selectionPixels';

/** World -> a node's local grid of pxW x pxH pixels covering its box (any node with a size). */
export function nodeGridMatrix(doc: QuvreloDocument, id: Id, pxW: number, pxH: number): Matrix | null {
  const loc = findNode(doc, id);
  if (!loc || !('w' in loc.node) || !('h' in loc.node)) return null;
  const n = loc.node as SceneNode & { w: number; h: number };
  return multiply(scale(pxW / n.w, pxH / n.h), multiply(translate(n.w / 2, n.h / 2), invert(worldMatrix(loc))));
}

function resampleAsset(assets: AssetStore, id: Id, w: number, h: number, method: ResampleMethod): Id | null {
  const c = assets.get(id);
  if (!c) return null;
  if (c.width === w && c.height === h) return id;
  const out = pixelsToCanvas(resample(canvasToPixels(c), w, h, method));
  return assets.add(out, 'image/png');
}

/**
 * Resize the document to W x H, scaling content. Top-level pixel layers (and
 * pixel masks) are resampled to their new pixel size with `method`, so the
 * file really gains or loses pixels; other content scales as vectors.
 */
export function resampleDocument(doc: QuvreloDocument, assets: AssetStore, W: number, H: number, method: ResampleMethod): QuvreloDocument {
  const sx = W / doc.settings.width;
  const sy = H / doc.settings.height;
  const meta = { ...doc.assets };
  const remask = (pm: PixelMask | undefined, w: number, h: number): PixelMask | undefined => {
    if (!pm) return pm;
    const c = assets.get(pm.assetId);
    if (!c) return pm;
    const id = resampleAsset(assets, pm.assetId, Math.max(1, Math.round(c.width * w)), Math.max(1, Math.round(c.height * h)), method);
    if (!id) return pm;
    meta[id] = assets.ref(id, 'Mask');
    return { ...pm, assetId: id };
  };
  const scaleNode = (n: SceneNode): SceneNode => {
    const moved = { ...n, x: n.x * sx, y: n.y * sy };
    if (n.type === 'raster') {
      const c = assets.get(n.assetId);
      if (c && Math.abs(n.rotation % 90) < 1e-6) {
        const rot = Math.round(n.rotation / 90) % 2 !== 0;
        const fx = rot ? sy : sx;
        const fy = rot ? sx : sy;
        const pw = Math.max(1, Math.round(c.width * fx));
        const ph = Math.max(1, Math.round(c.height * fy));
        const id = resampleAsset(assets, n.assetId, pw, ph, method);
        if (id) {
          meta[id] = assets.ref(id, n.name);
          return { ...moved, assetId: id, w: n.w * fx, h: n.h * fy, pixelMask: remask(n.pixelMask, fx, fy) } as RasterNode;
        }
      }
    }
    if (n.type === 'adjustment') return { ...n, x: n.x * sx, y: n.y * sy, w: n.w * sx, h: n.h * sy, pixelMask: remask(n.pixelMask, sx, sy) };
    return { ...moved, scaleX: n.scaleX * sx, scaleY: n.scaleY * sy };
  };
  return {
    ...doc,
    assets: meta,
    settings: { ...doc.settings, width: W, height: H },
    pages: doc.pages.map((p) => ({ ...p, nodes: p.nodes.map(scaleNode) })),
    masters: doc.masters.map((p) => ({ ...p, nodes: p.nodes.map(scaleNode) })),
    guides: doc.guides.map((g) => ({ ...g, position: g.position * (g.orientation === 'v' ? sx : sy) })),
  };
}

/** Canvas size: change the page without scaling, keeping content where the anchor says. */
export function canvasSize(doc: QuvreloDocument, W: number, H: number, a: Anchor): QuvreloDocument {
  const { dx, dy } = anchorOffset(doc.settings.width, doc.settings.height, W, H, a);
  const fx = doc.settings.width === W ? 0.5 : dx / (W - doc.settings.width);
  const fy = doc.settings.height === H ? 0.5 : dy / (H - doc.settings.height);
  return resizeDocument(doc, W, H, { x: fx, y: fy });
}

/** Rotate every top-level layer of the page by `deg` about the document centre (Straighten). */
export function rotateContent(doc: QuvreloDocument, pageId: Id, deg: number): QuvreloDocument {
  const cx = doc.settings.width / 2;
  const cy = doc.settings.height / 2;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const turn = (n: SceneNode): SceneNode => {
    const dx = n.x - cx;
    const dy = n.y - cy;
    return { ...n, x: cx + dx * c - dy * s, y: cy + dx * s + dy * c, rotation: (((n.rotation + deg) % 360) + 360) % 360 };
  };
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, nodes: p.nodes.map(turn) } : p)) };
}

/** Pixel grid size for a node's mask: the layer's own pixels for a pixel layer, else its box (capped). */
export function maskSizeFor(n: SceneNode, assets: AssetStore): { w: number; h: number } | null {
  if (!('w' in n) || !('h' in n)) return null;
  if (n.type === 'raster') {
    const c = assets.get(n.assetId);
    if (c) return { w: c.width, h: c.height };
  }
  const k = Math.min(1, 4096 / Math.max(n.w, n.h));
  return { w: Math.max(1, Math.round(n.w * k)), h: Math.max(1, Math.round(n.h * k)) };
}

/**
 * A new mask canvas for a node: from the selection (feathered) when given,
 * else all revealed (or all hidden).
 */
export function makeMaskCanvas(doc: QuvreloDocument, n: SceneNode, assets: AssetStore, sel: Parameters<typeof selectionCanvas>[0], feather: number, hideAll = false): HTMLCanvasElement | null {
  const size = maskSizeFor(n, assets);
  if (!size) return null;
  if (sel) {
    const m = nodeGridMatrix(doc, n.id, size.w, size.h);
    return m ? selectionCanvas(sel, feather, m, size.w, size.h) : null;
  }
  const c = createCanvas(size.w, size.h);
  if (!hideAll) {
    const x = ctx2d(c);
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, size.w, size.h);
  }
  return c;
}

/** Bake a pixel layer's mask into its alpha. Returns the new pixel canvas. */
export function bakeMask(n: RasterNode, assets: AssetStore): HTMLCanvasElement | null {
  const base = assets.get(n.assetId);
  const m = n.pixelMask ? assets.get(n.pixelMask.assetId) : null;
  if (!base || !m) return null;
  const out = createCanvas(base.width, base.height);
  const x = ctx2d(out);
  x.drawImage(base, 0, 0);
  if (n.pixelMask!.enabled) {
    x.globalCompositeOperation = n.pixelMask!.inverted ? 'destination-out' : 'destination-in';
    x.drawImage(m, 0, 0, out.width, out.height);
  }
  return out;
}

/** Mask coverage as a 0..255 array plus the grid -> world matrix (for "load as selection"). */
export function maskCoverage(doc: QuvreloDocument, n: SceneNode, assets: AssetStore): { cover: Uint8ClampedArray; w: number; h: number; toWorld: Matrix } | null {
  if (!n.pixelMask) return null;
  const c = assets.get(n.pixelMask.assetId);
  if (!c) return null;
  const g = nodeGridMatrix(doc, n.id, c.width, c.height);
  if (!g) return null;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  const cover = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < cover.length; i++) cover[i] = n.pixelMask.inverted ? 255 - d[i * 4 + 3] : d[i * 4 + 3];
  return { cover, w: c.width, h: c.height, toWorld: invert(g) };
}

export function setPixelMask(doc: QuvreloDocument, id: Id, pm: PixelMask | undefined): QuvreloDocument {
  return updateNode(doc, id, { pixelMask: pm } as Partial<SceneNode>);
}

export { apply };
