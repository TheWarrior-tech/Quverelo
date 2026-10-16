/**
 * Vector exports (SVG, vector PDF) cannot express adjustment layers, pixel
 * masks, clipping masks or the per-pixel blend modes. Before a vector export
 * the affected layers are flattened to pixels with the same renderer the
 * canvas uses, so the file looks exactly like the screen:
 *
 * - an adjustment layer or extra blend mode depends on everything below it,
 *   so the page background, master and every layer up to the topmost such
 *   layer become one picture;
 * - a pixel-masked layer, a clip run, or a group holding any of these becomes
 *   one picture of its own bounds.
 *
 * Everything else stays vector. Returns the input document when nothing
 * needs flattening (and how many pictures were made, for the export report).
 */
import { isNativeBlend } from '../../core/blend';
import { make } from '../../core/document';
import { newId } from '../../core/ids';
import type { QuvreloDocument, RasterNode, SceneNode } from '../../core/types';
import type { AssetStore } from './assets';
import { createCanvas, ctx2d } from './assets';
import { clipRuns, drawNodeList } from './compose';
import { masterItemsFor } from '../../core/layout';
import { drawNodeTransformed, renderBounds, type DrawEnv } from './draw';

/** Depends on what is composited below it. */
export function needsBackdrop(n: SceneNode): boolean {
  if (!n.visible) return false;
  if (n.type === 'adjustment' || !isNativeBlend(n.blend)) return true;
  // pass-through group: its children see the page below
  return n.type === 'group' && n.opacity >= 1 && n.blend === 'normal' && n.children.some(needsBackdrop);
}

/** Needs pixels but only of itself. */
export function needsPixels(n: SceneNode): boolean {
  if (!n.visible) return false;
  if (n.pixelMask?.enabled || n.clipped) return true;
  return n.type === 'group' && n.children.some((c) => needsPixels(c) || needsBackdrop(c));
}

function density(nodes: SceneNode[], assets: AssetStore): number {
  let d = 1;
  const visit = (ns: SceneNode[]) => ns.forEach((n) => {
    if (n.type === 'raster') {
      const c = assets.get(n.assetId);
      if (c) d = Math.max(d, (c.width / Math.max(1, n.w)) * Math.abs(n.scaleX));
    }
    if (n.type === 'group') visit(n.children);
  });
  visit(nodes);
  return d;
}

export function flattenForVector(doc: QuvreloDocument, assets: AssetStore): { doc: QuvreloDocument; flattened: number } {
  let flattened = 0;
  const env: DrawEnv = { doc, assets, editor: false, preview: false, zoom: 1 };
  const assetsMeta = { ...doc.assets };
  const picture = (box: { x: number; y: number; w: number; h: number }, scale: number, draw: (ctx: CanvasRenderingContext2D) => void, name: string): RasterNode => {
    const limit = 8000 / Math.max(box.w, box.h, 1);
    const k = Math.max(0.25, Math.min(scale, limit));
    const c = createCanvas(Math.ceil(box.w * k), Math.ceil(box.h * k));
    const ctx = ctx2d(c);
    ctx.scale(c.width / box.w, c.height / box.h);
    ctx.translate(-box.x, -box.y);
    draw(ctx);
    const id = assets.add(c, 'image/png', null, newId('a'));
    assetsMeta[id] = assets.ref(id, name);
    flattened++;
    return make.raster({ assetId: id, w: box.w, h: box.h, x: box.x + box.w / 2, y: box.y + box.h / 2, name });
  };
  const { width: W, height: H, background, bleed } = doc.settings;
  const pageBox = { x: -bleed, y: -bleed, w: W + 2 * bleed, h: H + 2 * bleed };

  const pages = doc.pages.map((p, pageIndex) => {
    // master items minus this page's overrides (core/layout.ts); fields show this page's number
    const masterNodes = masterItemsFor(doc, p);
    const master = masterNodes.length ? { nodes: masterNodes } : null;
    const penv: DrawEnv = { ...env, pageIndex };
    let nodes = p.nodes;
    let masterId = p.masterId;
    const runs = clipRuns(nodes);
    let cut = -1;
    runs.forEach((r, i) => {
      if (needsBackdrop(r.base) || r.followers.some(needsBackdrop)) cut = i;
    });
    const masterNeeds = master ? clipRuns(master.nodes).some((r) => needsBackdrop(r.base) || r.followers.some(needsBackdrop)) : false;
    if (cut >= 0 || masterNeeds) {
      const prefix = cut >= 0 ? runs.slice(0, cut + 1).flatMap((r) => [r.base, ...r.followers]) : [];
      const rest = cut >= 0 ? runs.slice(cut + 1).flatMap((r) => [r.base, ...r.followers]) : nodes;
      const flat = picture(pageBox, density([...(master?.nodes ?? []), ...prefix], assets), (ctx) => {
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(pageBox.x, pageBox.y, pageBox.w, pageBox.h);
        }
        if (master) drawNodeList(ctx, master.nodes, penv, drawNodeTransformed);
        drawNodeList(ctx, prefix, penv, drawNodeTransformed);
      }, 'Flattened layers');
      nodes = [flat, ...rest];
      masterId = null;
    }
    // self-contained pixel effects: one picture per clip run / masked layer / special group
    const out: SceneNode[] = [];
    for (const r of clipRuns(nodes)) {
      const items = [r.base, ...r.followers];
      if (r.followers.length || needsPixels(r.base)) {
        const b = renderBounds(r.base);
        if (b.w > 0 && b.h > 0 && r.base.visible) {
          out.push(picture(b, density(items, assets), (ctx) => drawNodeList(ctx, items, penv, drawNodeTransformed), r.base.name || 'Layer'));
        }
      } else out.push(...items);
    }
    return { ...p, nodes: out, masterId };
  });
  if (!flattened) return { doc, flattened: 0 };
  return { doc: { ...doc, pages, assets: assetsMeta }, flattened };
}
