/**
 * PSD export (File › Export › Photoshop PSD). Every object becomes its own
 * Photoshop layer (rendered at document resolution, cropped to its bounds);
 * groups become layer groups. Names, visibility, opacity, blend modes and locks
 * are kept. A flattened composite is included so any PSD reader can show it.
 * Writing uses ag-psd (MIT, bundled, offline).
 */
import { writePsdUint8Array, type Layer, type Psd } from 'ag-psd';
import { findNode, nodeMatrix, worldMatrix } from '../../core/document';
import { multiply, type Matrix } from '../../core/geometry';
import { blendToPsd } from '../../core/interop/psd';
import type { QuvreloDocument, SceneNode } from '../../core/types';
import type { AssetStore } from './assets';
import { createCanvas, ctx2d } from './assets';
import { drawNodeTransformed, renderLocalBounds } from './draw';
import { renderPageCanvas } from './export';

const MAX_PSD = 30000; // PSD limit (PSB beyond)

function nodeLayerPixels(doc: QuvreloDocument, assets: AssetStore, n: SceneNode): Layer | null {
  const loc = findNode(doc, n.id);
  if (!loc) return null;
  const m = worldMatrix(loc);
  const b = renderLocalBounds(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) {
    const X = m[0] * px + m[2] * py + m[4];
    const Y = m[1] * px + m[3] * py + m[5];
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
  }
  const W = doc.settings.width, H = doc.settings.height;
  const left = Math.max(0, Math.floor(x0)), top = Math.max(0, Math.floor(y0));
  const right = Math.min(W, Math.ceil(x1)), bottom = Math.min(H, Math.ceil(y1));
  if (right <= left || bottom <= top) return { top: 0, left: 0, bottom: 0, right: 0 };
  const c = createCanvas(right - left, bottom - top);
  const ctx = ctx2d(c);
  ctx.translate(-left, -top);
  // parent transforms, then the node itself drawn at full opacity / normal blend (the layer carries those)
  let parent: Matrix = [1, 0, 0, 1, 0, 0];
  for (const g of loc.ancestors) parent = multiply(parent, nodeMatrix(g));
  ctx.transform(parent[0], parent[1], parent[2], parent[3], parent[4], parent[5]);
  drawNodeTransformed(ctx, { ...n, opacity: 1, blend: 'normal', visible: true }, { doc, assets, editor: false, preview: false, zoom: 1 });
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  return { left, top, right, bottom, imageData };
}

function toLayer(doc: QuvreloDocument, assets: AssetStore, n: SceneNode): Layer | null {
  const meta: Layer = {
    name: n.name,
    hidden: !n.visible,
    opacity: n.opacity,
    blendMode: blendToPsd(n.blend),
    protected: n.locked ? { position: true, composite: true } : undefined,
  };
  if (n.type === 'group') {
    const children = n.children.map((c) => toLayer(doc, assets, c)).filter((l): l is Layer => !!l);
    return { ...meta, opened: true, children };
  }
  const px = nodeLayerPixels(doc, assets, n);
  return px ? { ...meta, ...px } : null;
}

export function exportPsd(doc: QuvreloDocument, assets: AssetStore, pageIndex = 0): Uint8Array {
  const W = Math.round(doc.settings.width), H = Math.round(doc.settings.height);
  if (W > MAX_PSD || H > MAX_PSD) throw new Error('This document is larger than 30,000 px, the PSD limit');
  const page = doc.pages[pageIndex];
  const comp = renderPageCanvas(doc, assets, { pageIndex, scale: 1, includeBleed: false, transparent: !doc.settings.background });
  const children: Layer[] = [];
  if (doc.settings.background) {
    const bg = createCanvas(W, H);
    const bx = ctx2d(bg);
    bx.fillStyle = doc.settings.background;
    bx.fillRect(0, 0, W, H);
    children.push({ name: 'Background', left: 0, top: 0, right: W, bottom: H, imageData: bx.getImageData(0, 0, W, H) });
  }
  for (const n of page.nodes) {
    const l = toLayer(doc, assets, n);
    if (l) children.push(l);
  }
  const psd: Psd = {
    width: W,
    height: H,
    children,
    imageData: ctx2d(comp).getImageData(0, 0, comp.width, comp.height),
    imageResources: {
      resolutionInfo: {
        horizontalResolution: doc.settings.dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches',
        verticalResolution: doc.settings.dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches',
      },
    },
  };
  return writePsdUint8Array(psd, { generateThumbnail: false, noBackground: !doc.settings.background });
}
