/**
 * 16 bits per channel page render for 16-bit Photo documents (PNG export).
 *
 * Pixel layers are composited from their 16-bit originals with the
 * adjustment stack run at 16 bits (core/pixels16.ts) by core/composite16.ts,
 * with the same transforms, opacity, masks and blend modes the canvas uses
 * on screen. Everything else (shapes, text, frames) is drawn by the normal
 * canvas renderer at the export size and blended in, so it looks identical;
 * those objects are 8-bit in origin, but the photo under them keeps its 16
 * bits. Image frames (Layout) are drawn by the canvas too, at 8 bits.
 */
import { Compositor16 } from '../../core/composite16';
import { multiply, scale as scaleM, translate, composeTransform, type Matrix } from '../../core/geometry';
import type { BlendMode, QuvreloDocument, SceneNode } from '../../core/types';
import type { Pixels16 } from '../../core/pixels16';
import type { AssetStore } from './assets';
import { createCanvas } from './assets';
import { drawNodeTransformed, toPath2D, type DrawEnv } from './draw';
import type { RasterExportOptions } from './export';

/** Does this subtree need to be walked here (pixel layers, or blend modes that must see what is under the group)? */
function needsWalk(n: SceneNode): boolean {
  if (n.type === 'raster') return true;
  if (n.type === 'group') return n.children.some((c) => c.visible && (c.blend !== 'normal' || needsWalk(c)));
  return false;
}

export function renderPage16(doc: QuvreloDocument, assets: AssetStore, o: RasterExportOptions): Pixels16 {
  const b = o.includeBleed ? doc.settings.bleed : 0;
  const w = (doc.settings.width + 2 * b) * o.scale;
  const h = (doc.settings.height + 2 * b) * o.scale;
  const k = Math.min(1, 16384 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k));
  const H = Math.max(1, Math.round(h * k));
  const comp = new Compositor16(W, H);
  const docForRender = o.transparent ? { ...doc, settings: { ...doc.settings, background: null } } : doc;
  const env: DrawEnv = { doc: docForRender, assets, editor: false, preview: false, zoom: o.scale };
  const bg = docForRender.settings.background;
  if (bg) {
    const c = createCanvas(1, 1);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.fillStyle = bg;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    comp.fill(d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255);
  }
  const base: Matrix = multiply(scaleM(o.scale * k, o.scale * k), translate(b, b));

  const layer = () => {
    const c = createCanvas(W, H);
    return { c, ctx: c.getContext('2d', { willReadFrequently: true })! };
  };
  const read = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;

  const maskCoverage = (n: SceneNode, m: Matrix, parent: Float32Array | null): Float32Array | null => {
    if (!n.mask?.enabled || !n.mask.d.length) return parent;
    const { c, ctx } = layer();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = '#fff';
    if (n.mask.inverted) {
      const p = new Path2D();
      p.rect(-1e6, -1e6, 2e6, 2e6);
      p.addPath(toPath2D(n.mask.d));
      ctx.fill(p, 'evenodd');
    } else ctx.fill(toPath2D(n.mask.d), 'evenodd');
    const d = read(c);
    const cov = new Float32Array(W * H);
    for (let i = 0; i < cov.length; i++) cov[i] = (d[i * 4 + 3] / 255) * (parent ? parent[i] : 1);
    return cov;
  };

  const walk = (nodes: SceneNode[], parentM: Matrix, opacity: number, inherited: BlendMode, coverage: Float32Array | null) => {
    let batch: SceneNode[] = [];
    const drawCanvas = (list: SceneNode[], mode: BlendMode) => {
      if (!list.length) return;
      const { c, ctx } = layer();
      ctx.setTransform(parentM[0], parentM[1], parentM[2], parentM[3], parentM[4], parentM[5]);
      ctx.globalAlpha = opacity;
      for (const n of list) drawNodeTransformed(ctx, mode === 'normal' ? n : { ...n, blend: 'normal' }, env);
      comp.drawRgba8(read(c), mode, coverage);
    };
    const flush = () => {
      drawCanvas(batch, 'normal');
      batch = [];
    };
    for (const n of nodes) {
      if (!n.visible) continue;
      const mode: BlendMode = n.blend !== 'normal' ? n.blend : inherited;
      if (n.type === 'raster') {
        flush();
        const r = assets.renderedPixels16(n.assetId, n.adjustments, false);
        if (!r) continue;
        const nodeM = multiply(parentM, composeTransform(n));
        const m = multiply(nodeM, multiply(translate(-n.w / 2, -n.h / 2), scaleM(n.w / r.pixels.width, n.h / r.pixels.height)));
        comp.drawImage16(r.pixels, m, opacity * n.opacity, mode, maskCoverage(n, nodeM, coverage));
      } else if (n.type === 'group' && needsWalk(n)) {
        flush();
        const nodeM = multiply(parentM, composeTransform(n));
        walk(n.children, nodeM, opacity * n.opacity, mode, maskCoverage(n, nodeM, coverage));
      } else if (mode === 'normal') {
        batch.push(n);
      } else {
        flush();
        drawCanvas([n], mode);
      }
    }
    flush();
  };

  const page = doc.pages[o.pageIndex];
  const master = page?.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
  walk([...(master?.nodes ?? []), ...(page?.nodes ?? [])], base, 1, 'normal', null);
  return comp.toPixels16();
}
