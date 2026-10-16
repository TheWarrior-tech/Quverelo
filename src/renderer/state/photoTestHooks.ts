/**
 * End-to-end test hooks for the Photo parity features (window.__quvreloPhoto),
 * installed next to window.__quvrelo. They read rendered pixels (export
 * renderer and the live viewport), build layers from plain data and expose the
 * reference blend formulas, so tests compare the app against the maths.
 */
import { addNodes } from '../../core/commands';
import { make } from '../../core/document';
import { compositePixel, type RGB } from '../../core/blend';
import type { BlendMode, SceneNode } from '../../core/types';
import { editor } from './editor';
import { getViewport } from './commands';
import { createCanvas, ctx2d } from '../engine/assets';
import { renderPageCanvas, exportSvg } from '../engine/export';
import { flattenForVector } from '../engine/flattenExport';
import { setTestPressure } from '../engine/photoTools';
import { computeHistogram } from '../ui/panels/HistogramPanel';
import { histStats } from '../../core/histogramStats';
import { newBlank } from './io';

type RGBA = [number, number, number, number];

function renderPixel(x: number, y: number): RGBA {
  const doc = editor.doc!;
  const c = renderPageCanvas(doc, editor.assets, { scale: 1, pageIndex: Math.max(0, editor.activePageIndex), includeBleed: false, transparent: false } as never);
  return [...c.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data] as RGBA;
}

/** Pixel of the live viewport (fabric lower canvas) under a document point. */
function viewportPixel(x: number, y: number): RGBA | null {
  const vp = getViewport();
  if (!vp) return null;
  vp.canvas.renderAll();
  const el = (vp.canvas as unknown as { lowerCanvasEl: HTMLCanvasElement }).lowerCanvasEl;
  const v = vp.canvas.viewportTransform;
  const dpr = el.width / vp.canvas.getWidth();
  const sx = (x * v[0] + v[4]) * dpr;
  const sy = (y * v[3] + v[5]) * dpr;
  return [...el.getContext('2d')!.getImageData(Math.floor(sx), Math.floor(sy), 1, 1).data] as RGBA;
}

/** Add a solid-colour pixel layer covering a rectangle (document px). */
function addSolidLayer(color: string, rect?: { x: number; y: number; w: number; h: number }, init: Partial<SceneNode> = {}): string {
  const doc = editor.doc!;
  const r = rect ?? { x: 0, y: 0, w: doc.settings.width, h: doc.settings.height };
  const c = createCanvas(r.w, r.h);
  const x = ctx2d(c);
  x.fillStyle = color;
  x.fillRect(0, 0, r.w, r.h);
  const id = editor.assets.add(c, 'image/png');
  const node = make.raster({ assetId: id, w: r.w, h: r.h, x: r.x + r.w / 2, y: r.y + r.h / 2, name: init.name ?? color, ...(init as object) });
  const cont = editor.activeContainer!;
  editor.commit('Test layer', (d) => addNodes({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, node.name) } }, cont.id, [node]));
  return node.id;
}

/** Add a raster from a pixel generator fn(x, y) -> RGBA (document-sized unless given). */
function addPatternLayer(kind: 'gradient' | 'checker' | 'noise' | 'dot', w?: number, h?: number): string {
  const doc = editor.doc!;
  const W = w ?? doc.settings.width;
  const H = h ?? doc.settings.height;
  const c = createCanvas(W, H);
  const x = ctx2d(c);
  const img = x.createImageData(W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      let v: RGBA;
      if (kind === 'gradient') v = [Math.round((i / (W - 1)) * 255), Math.round((j / (H - 1)) * 255), 128, 255];
      else if (kind === 'checker') v = ((i >> 3) + (j >> 3)) % 2 ? [230, 230, 230, 255] : [30, 30, 30, 255];
      else if (kind === 'noise') {
        const n = 128 + (rnd() - 0.5) * 120;
        v = [n, n, n, 255];
      } else {
        const d = Math.hypot(i - W / 2, j - H / 2);
        v = d < Math.min(W, H) / 10 ? [200, 30, 30, 255] : [120, 140, 160, 255];
      }
      img.data.set(v, k);
    }
  x.putImageData(img, 0, 0);
  const id = editor.assets.add(c, 'image/png');
  const node = make.raster({ assetId: id, w: W, h: H, x: W / 2, y: H / 2, name: kind });
  const cont = editor.activeContainer!;
  editor.commit('Test layer', (d) => addNodes({ ...d, assets: { ...d.assets, [id]: editor.assets.ref(id, node.name) } }, cont.id, [node]));
  editor.select([node.id]);
  return node.id;
}

/** Straight-alpha reference result of compositing s over b with a mode (0..255). */
function referenceBlend(mode: BlendMode, b: RGBA, s: RGBA, opacity = 1): RGBA {
  const n = (v: RGBA): RGB => [v[0] / 255, v[1] / 255, v[2] / 255];
  const o = compositePixel(mode, n(b), b[3] / 255, n(s), (s[3] / 255) * opacity);
  return [o[0] * 255, o[1] * 255, o[2] * 255, o[3] * 255].map((x) => Math.round(x)) as RGBA;
}

/** Pixel of a layer's own pixel asset (layer grid coordinates). */
function layerPixel(id: string, x: number, y: number): RGBA | null {
  const n = editor.doc && (editor.activeContainer?.nodes.find((q) => q.id === id) as SceneNode | undefined);
  if (!n || n.type !== 'raster') return null;
  const c = editor.assets.get(n.assetId);
  return c ? ([...c.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data] as RGBA) : null;
}

function maskPixel(id: string, x: number, y: number): number | null {
  const n = editor.activeContainer?.nodes.find((q) => q.id === id);
  const pm = n?.pixelMask;
  const c = pm ? editor.assets.get(pm.assetId) : null;
  return c ? c.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] : null;
}

/** Luminance standard deviation of a layer region (noise measure). */
function layerStats(id: string): { mean: number; std: number } | null {
  const n = editor.activeContainer?.nodes.find((q) => q.id === id);
  if (!n || n.type !== 'raster') return null;
  const c = editor.assets.get(n.assetId);
  if (!c) return null;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let s = 0, q = 0, k = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    s += l;
    q += l * l;
    k++;
  }
  const mean = s / k;
  return { mean, std: Math.sqrt(Math.max(0, q / k - mean * mean)) };
}

export function installPhotoTestHooks(): void {
  (window as unknown as { __quvreloPhoto: unknown }).__quvreloPhoto = {
    newPhoto: (w: number, h: number, background: string | null = '#ffffff') => {
      newBlank({ title: 'Test', width: w, height: h, unit: 'px', pages: 1, studio: 'photo', margins: 0, bleed: 0, background, dpi: 72 });
    },
    renderPixel,
    viewportPixel,
    addSolidLayer,
    addPatternLayer,
    referenceBlend,
    layerPixel,
    maskPixel,
    layerStats,
    setPressure: setTestPressure,
    histogram: (src: 'layer' | 'document') => {
      const h = computeHistogram(src);
      return h ? histStats(h.l) : null;
    },
    svgImageCount: () => (exportSvg(editor.doc!, editor.assets, 0).match(/<image/g) ?? []).length,
    flattenCount: () => flattenForVector(editor.doc!, editor.assets).flattened,
  };
}

if (typeof window !== 'undefined') installPhotoTestHooks();
