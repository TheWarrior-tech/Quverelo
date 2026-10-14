/** Exporters: PNG, JPEG, SVG and multi-page PDF (all offline). */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { pageToSvg } from '../../core/svg';
import type { QuvreloDocument } from '../../core/types';
import type { AssetStore } from './assets';
import { canvasToBytes, createCanvas, ctx2d } from './assets';
import { drawPage, measureText } from './draw';

export interface RasterExportOptions {
  pageIndex: number;
  scale: number; // output pixels per document px
  includeBleed: boolean;
  transparent: boolean;
}

export function renderPageCanvas(doc: QuvreloDocument, assets: AssetStore, o: RasterExportOptions): HTMLCanvasElement {
  const b = o.includeBleed ? doc.settings.bleed : 0;
  const w = (doc.settings.width + 2 * b) * o.scale;
  const h = (doc.settings.height + 2 * b) * o.scale;
  const max = 16384;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = createCanvas(w * k, h * k);
  const ctx = ctx2d(canvas);
  ctx.scale(o.scale * k, o.scale * k);
  ctx.translate(b, b);
  const docForRender = o.transparent ? { ...doc, settings: { ...doc.settings, background: null } } : doc;
  if (!o.transparent && !doc.settings.background) {
    // JPEG etc. need an opaque background
  }
  drawPage(ctx, docForRender, o.pageIndex, { doc: docForRender, assets, editor: false, preview: false, zoom: o.scale }, true);
  return canvas;
}

export async function exportRaster(
  doc: QuvreloDocument, assets: AssetStore, o: RasterExportOptions & { format: 'png' | 'jpg' | 'webp'; quality: number },
): Promise<Uint8Array> {
  const c = renderPageCanvas(doc, assets, { ...o, transparent: o.format === 'png' ? o.transparent : false });
  if (o.format === 'jpg') {
    // flatten onto white
    const flat = createCanvas(c.width, c.height);
    const ctx = ctx2d(flat);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(c, 0, 0);
    return canvasToBytes(flat, 'image/jpeg', o.quality);
  }
  return canvasToBytes(c, o.format === 'webp' ? 'image/webp' : 'image/png', o.quality);
}

export function exportSvg(doc: QuvreloDocument, assets: AssetStore, pageIndex: number, includeBleed = false): string {
  const page = doc.pages[pageIndex];
  return pageToSvg(doc, page, {
    measure: measureText,
    includeBleed,
    assetHref: (id, node) => {
      if (node && node.type === 'raster') {
        const c = assets.rendered(id, node.adjustments, false);
        return c ? c.toDataURL('image/png') : null;
      }
      return assets.dataUrl(id);
    },
  });
}

export interface PdfExportOptions {
  dpi: number;
  includeBleed: boolean;
  cropMarks: boolean;
  quality: number; // jpeg quality 0..1
  pages: number[] | 'all';
  onProgress?: (done: number, total: number) => void;
}

const PT_PER_PX = 72 / 96;

export async function exportPdf(doc: QuvreloDocument, assets: AssetStore, o: PdfExportOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator('Quvrelo');
  pdf.setProducer('Quvrelo (pdf-lib)');
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());
  const indices = o.pages === 'all' ? doc.pages.map((_, i) => i) : o.pages;
  const bleed = o.includeBleed ? doc.settings.bleed : 0;
  const markLen = o.cropMarks ? 24 : 0; // px of slug for crop marks
  const scale = o.dpi / 96;
  let done = 0;
  for (const i of indices) {
    const c = renderPageCanvas(doc, assets, { pageIndex: i, scale, includeBleed: o.includeBleed, transparent: false });
    // flatten (JPEG has no alpha)
    const flat = createCanvas(c.width, c.height);
    const fctx = ctx2d(flat);
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(c, 0, 0);
    const bytes = await canvasToBytes(flat, 'image/jpeg', o.quality);
    const img = await pdf.embedJpg(bytes);
    const wPx = doc.settings.width + 2 * bleed;
    const hPx = doc.settings.height + 2 * bleed;
    const pageW = (wPx + 2 * markLen) * PT_PER_PX;
    const pageH = (hPx + 2 * markLen) * PT_PER_PX;
    const page = pdf.addPage([pageW, pageH]);
    page.drawImage(img, { x: markLen * PT_PER_PX, y: markLen * PT_PER_PX, width: wPx * PT_PER_PX, height: hPx * PT_PER_PX });
    // page boxes so print shops can find trim and bleed
    const trim = [
      (markLen + bleed) * PT_PER_PX,
      (markLen + bleed) * PT_PER_PX,
      (markLen + bleed + doc.settings.width) * PT_PER_PX,
      (markLen + bleed + doc.settings.height) * PT_PER_PX,
    ];
    page.node.set(PDFName.of('TrimBox'), pdf.context.obj(trim));
    page.node.set(PDFName.of('BleedBox'), pdf.context.obj([markLen * PT_PER_PX, markLen * PT_PER_PX, (markLen + wPx) * PT_PER_PX, (markLen + hPx) * PT_PER_PX]));
    if (o.cropMarks) {
      const [x0, y0, x1, y1] = trim;
      const off = (bleed + 4) * PT_PER_PX;
      const len = 14;
      const line = (ax: number, ay: number, bx: number, by: number) =>
        page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: 0.3 });
      for (const [x, sx] of [[x0, -1], [x1, 1]] as const) {
        for (const [y, sy] of [[y0, -1], [y1, 1]] as const) {
          line(x + sx * off, y, x + sx * (off + len), y);
          line(x, y + sy * off, x, y + sy * (off + len));
        }
      }
    }
    done++;
    o.onProgress?.(done, indices.length);
  }
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('en'));
  return pdf.save();
}
