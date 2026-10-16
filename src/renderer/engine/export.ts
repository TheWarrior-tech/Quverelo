/** Exporters: PNG, JPEG, SVG, vector PDF and image PDF (all offline). */
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { pageToSvg } from '../../core/svg';
import { findNode, nodeMatrix, worldMatrix } from '../../core/document';
import { multiply, type Matrix } from '../../core/geometry';
import { exportVectorPdf, type PdfColourOutput, type PdfImageData, type PdfPixelHooks, type RgbaImage, type VectorPdfReport } from '../../core/pdfVector';
import { docColour, PROFILES, type CmykProfileId } from '../../core/colour/profiles';
import type { PdfxStandard } from '../../core/colour/pdfx';
import { loadColourEngine, profileFileBytes } from './colour';
import { embedIccInJpeg, embedIccInPng } from '../../core/colour/embedIcc';
import { encodePng16 } from '../../core/png16';
import { renderPage16 } from './export16';
import { bundledFaceFor } from '../../core/pdfFonts';
import type { Id, QuvreloDocument, SceneNode } from '../../core/types';
import { docPxPerInch, pdfPtPerPx } from '../../core/units';
import type { AssetStore } from './assets';
import { canvasToBytes, createCanvas, ctx2d } from './assets';
import { artisticTextSize, drawNodeContent, drawNodeTransformed, drawPage, measureText, renderLocalBounds, storyFlow } from './draw';
import { fontUrl } from './pdfFontFiles';

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

/** Bits per channel an export of this document writes by default (16 for 16-bit Photo documents' PNGs). */
export function defaultExportBitDepth(doc: QuvreloDocument, format: 'png' | 'jpg' | 'webp'): 8 | 16 {
  return format === 'png' && docColour(doc.settings).bitDepth === 16 ? 16 : 8;
}

/** Embed the document's RGB profile (PNG iCCP / JPEG APP2) so other apps read its colours correctly. */
export async function embedDocProfile(doc: QuvreloDocument, bytes: Uint8Array, format: 'png' | 'jpg' | 'webp'): Promise<Uint8Array> {
  if (format === 'webp') return bytes;
  const id = docColour(doc.settings).rgbProfile;
  const profile = await profileFileBytes(id);
  if (format === 'jpg') return embedIccInJpeg(bytes, profile);
  // the readable profile name (the compact profiles' own descriptions are terse, such as "A98C")
  return embedIccInPng(bytes, profile, PROFILES[id].name);
}

export async function exportRaster(
  doc: QuvreloDocument, assets: AssetStore, o: RasterExportOptions & { format: 'png' | 'jpg' | 'webp'; quality: number; bitDepth?: 8 | 16 },
): Promise<Uint8Array> {
  if (o.format === 'png' && (o.bitDepth ?? defaultExportBitDepth(doc, 'png')) === 16) {
    const px = renderPage16(doc, assets, o);
    return embedDocProfile(doc, encodePng16(px), 'png');
  }
  const c = renderPageCanvas(doc, assets, { ...o, transparent: o.format === 'png' ? o.transparent : false });
  if (o.format === 'jpg') {
    // flatten onto white
    const flat = createCanvas(c.width, c.height);
    const ctx = ctx2d(flat);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(c, 0, 0);
    return embedDocProfile(doc, await canvasToBytes(flat, 'image/jpeg', o.quality), 'jpg');
  }
  return embedDocProfile(doc, await canvasToBytes(c, o.format === 'webp' ? 'image/webp' : 'image/png', o.quality), o.format);
}

export function exportSvg(doc: QuvreloDocument, assets: AssetStore, pageIndex: number, includeBleed = false): string {
  const page = doc.pages[pageIndex];
  return pageToSvg(doc, page, {
    measure: measureText,
    includeBleed,
    assetHref: (id, node) => {
      if (node && node.type === 'raster') {
        const c = assets.rendered(id, node.adjustments, false, docColour(doc.settings).bitDepth === 16);
        return c ? c.toDataURL('image/png') : null;
      }
      return assets.dataUrl(id);
    },
  });
}

/** Options for the image PDF: every page is one picture. */
export interface PdfExportOptions {
  dpi: number;
  includeBleed: boolean;
  cropMarks: boolean;
  quality: number; // jpeg quality 0..1
  pages: number[] | 'all';
  onProgress?: (done: number, total: number) => void;
}

export async function exportImagePdf(doc: QuvreloDocument, assets: AssetStore, o: PdfExportOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setCreator('Quvrelo');
  pdf.setProducer('Quvrelo (pdf-lib)');
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());
  const indices = o.pages === 'all' ? doc.pages.map((_, i) => i) : o.pages;
  const bleed = o.includeBleed ? doc.settings.bleed : 0;
  // a px document's physical size comes from its Output DPI (CRITIQUE-4 P2-17)
  const PT_PER_PX = pdfPtPerPx(doc.settings);
  const pxScale = docPxPerInch(doc.settings) / 96;
  const markLen = o.cropMarks ? 24 * pxScale : 0; // px of slug for crop marks
  const scale = o.dpi / docPxPerInch(doc.settings);
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
      const off = (bleed + 4 * pxScale) * PT_PER_PX;
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

// ---------------------------------------------------------------------------
// Selection export (PNG/JPEG Area = Selection)

/** Bounds of the selected nodes in page space. */
export function selectionBounds(doc: QuvreloDocument, ids: Id[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const loc = findNode(doc, id);
    if (!loc || !loc.node.visible) continue;
    const m = worldMatrix(loc);
    const b = renderLocalBounds(loc.node);
    for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) {
      const X = m[0] * px + m[2] * py + m[4];
      const Y = m[1] * px + m[3] * py + m[5];
      x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y);
    }
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Only the selected objects, cropped to their bounds. */
export function renderSelectionCanvas(doc: QuvreloDocument, assets: AssetStore, ids: Id[], scale: number, transparent: boolean): HTMLCanvasElement | null {
  const b = selectionBounds(doc, ids);
  if (!b) return null;
  const k = Math.min(1, 16384 / Math.max(b.w * scale, b.h * scale));
  const c = createCanvas(Math.max(1, Math.ceil(b.w * scale * k)), Math.max(1, Math.ceil(b.h * scale * k)));
  const ctx = ctx2d(c);
  if (!transparent && doc.settings.background) {
    ctx.fillStyle = doc.settings.background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.scale(scale * k, scale * k);
  ctx.translate(-b.x, -b.y);
  const env = { doc, assets, editor: false, preview: false, zoom: scale };
  for (const id of ids) {
    const loc = findNode(doc, id);
    if (!loc) continue;
    let m: Matrix = [1, 0, 0, 1, 0, 0];
    for (const g of loc.ancestors) m = multiply(m, nodeMatrix(g));
    ctx.save();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    drawNodeTransformed(ctx, loc.node, env);
    ctx.restore();
  }
  return c;
}

export async function exportSelectionRaster(
  doc: QuvreloDocument, assets: AssetStore, ids: Id[], o: { scale: number; transparent: boolean; format: 'png' | 'jpg'; quality: number },
): Promise<Uint8Array> {
  const c = renderSelectionCanvas(doc, assets, ids, o.scale, o.format === 'png' && o.transparent);
  if (!c) throw new Error('Nothing selected to export');
  if (o.format === 'jpg') {
    const flat = createCanvas(c.width, c.height);
    const fx = ctx2d(flat);
    fx.fillStyle = '#ffffff';
    fx.fillRect(0, 0, flat.width, flat.height);
    fx.drawImage(c, 0, 0);
    return embedDocProfile(doc, await canvasToBytes(flat, 'image/jpeg', o.quality), 'jpg');
  }
  return embedDocProfile(doc, await canvasToBytes(c, 'image/png'), 'png');
}

// ---------------------------------------------------------------------------
// Vector PDF

export interface VectorPdfExportOptions {
  pages: number[];
  includeBleed: boolean;
  cropMarks: boolean;
  /** JPEG quality for photos that have to be re-encoded (0..1) */
  quality: number;
  /** resolution for the few objects PDF can't draw as vectors */
  fallbackDpi: number;
  /** print output: CMYK for this press, optionally as PDF/X (absent = RGB) */
  print?: { cmykProfile: CmykProfileId; standard: PdfxStandard | null };
}

function canvasRgba(c: HTMLCanvasElement): RgbaImage {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

/** Pixels for CMYK output: what the canvas renderer draws, read back as RGBA. */
function pixelHooks(doc: QuvreloDocument, assets: AssetStore): PdfPixelHooks {
  const env = (zoom: number) => ({ doc, assets, editor: false, preview: false, zoom });
  return {
    raster: async (n) => {
      const c = assets.rendered(n.assetId, n.adjustments, false, docColour(doc.settings).bitDepth === 16);
      return c ? canvasRgba(c) : null;
    },
    asset: async (id) => {
      const c = assets.get(id);
      return c ? canvasRgba(c) : null;
    },
    rasterise: async (n, ppu) => {
      const b = renderLocalBounds(n);
      const sw = 'stroke' in n && n.stroke.width > 0 ? n.stroke.width : 0;
      const pad = sw / 2 + 2;
      const box = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
      const k = Math.min(ppu, 8000 / Math.max(box.w, box.h, 1));
      const c = createCanvas(Math.max(1, Math.ceil(box.w * k)), Math.max(1, Math.ceil(box.h * k)));
      const ctx = ctx2d(c);
      ctx.scale(k, k);
      ctx.translate(-box.x, -box.y);
      drawNodeContent(ctx, n, env(k));
      return { ...canvasRgba(c), box };
    },
    composite: async (pageIndex, count, box, ppu) => {
      const page = doc.pages[pageIndex];
      if (!page) return null;
      const master = page.masterId ? doc.masters.find((m) => m.id === page.masterId) : null;
      const nodes = [...(master?.nodes ?? []), ...page.nodes].slice(0, count);
      const k = Math.min(ppu, 8000 / Math.max(box.w, box.h, 1));
      const c = createCanvas(Math.max(1, Math.round(box.w * k)), Math.max(1, Math.round(box.h * k)));
      const ctx = ctx2d(c);
      // paper white under everything (PDF/X-1a pages are opaque)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(c.width / box.w, c.height / box.h);
      ctx.translate(-box.x, -box.y);
      const flat: QuvreloDocument = { ...doc, pages: doc.pages.map((p, i) => (i === pageIndex ? { ...p, masterId: null, nodes } : p)) };
      drawPage(ctx, flat, pageIndex, env(k), true);
      return canvasRgba(c);
    },
    bounds: (n) => {
      const b = renderLocalBounds(n);
      const sw = 'stroke' in n && n.stroke.width > 0 ? n.stroke.width : 0;
      const pad = sw / 2 + 1;
      return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    },
  };
}

/** How document colours become the press's CMYK (lcms2, the document's RGB profile and intent). */
export async function printColour(doc: QuvreloDocument, cmykProfile: CmykProfileId, standard: PdfxStandard | null): Promise<PdfColourOutput> {
  const e = await loadColourEngine();
  const c = docColour(doc.settings);
  // vector colours: relative colorimetric keeps in-gamut colours exact; photos use the document intent
  const vec = { intent: 'relative' as const, bpc: true };
  const img = { intent: c.intent };
  return {
    cmyk: (rgb) => e.rgbToCmyk(rgb, c.rgbProfile, cmykProfile, vec),
    image: (px) => (px.data instanceof Uint16Array
      ? e.rgba16ToCmyk(px.data, px.width * px.height, c.rgbProfile, cmykProfile, img)
      : e.rgbaToCmyk(px.data, px.width * px.height, c.rgbProfile, cmykProfile, img)),
    pdfx: standard ? { standard, profile: e.profileBytes(cmykProfile), condition: PROFILES[cmykProfile].pdfx! } : undefined,
  };
}

function isOpaque(c: HTMLCanvasElement): boolean {
  const data = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return false;
  return true;
}

async function canvasImage(c: HTMLCanvasElement, quality: number): Promise<PdfImageData> {
  return isOpaque(c)
    ? { bytes: await canvasToBytes(c, 'image/jpeg', quality), mime: 'image/jpeg' }
    : { bytes: await canvasToBytes(c, 'image/png'), mime: 'image/png' };
}

const fontBytes = new Map<string, Promise<Uint8Array | null>>();
function loadFont(key: string): Promise<Uint8Array | null> {
  let p = fontBytes.get(key);
  if (!p) {
    const url = fontUrl(key);
    p = url
      ? fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status))))).then((b) => new Uint8Array(b)).catch(() => null)
      : Promise.resolve(null);
    fontBytes.set(key, p);
  }
  return p;
}

/** Shapes and text as PDF vectors with embedded fonts; photos at their own resolution. */
export async function exportPdf(doc: QuvreloDocument, assets: AssetStore, o: VectorPdfExportOptions): Promise<{ bytes: Uint8Array; report: VectorPdfReport }> {
  const colour = o.print ? await printColour(doc, o.print.cmykProfile, o.print.standard) : undefined;
  return exportVectorPdf(doc, { pages: o.pages, includeBleed: o.includeBleed, cropMarks: o.cropMarks, fallbackDpi: o.fallbackDpi, colour }, {
    pixels: colour ? pixelHooks(doc, assets) : undefined,
    measure: measureText,
    textSize: artisticTextSize,
    flow: (id) => storyFlow(doc, id),
    font: async (style) => {
      const face = bundledFaceFor(style);
      const fam = style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (!face) return `“${fam}” is a system font, which can't be embedded`;
      if (face.synthBold) return `“${fam}” has no ${style.fontWeight} weight`;
      const key = `${face.pkg}/${face.file}`;
      const bytes = await loadFont(key);
      if (!bytes) return `“${fam}” could not be loaded`;
      return { key, bytes, synthItalic: face.synthItalic };
    },
    rasterPixels: async (n) => {
      const active = n.adjustments.filter((a) => a.enabled);
      if (!active.length) {
        // a JPEG goes in as it came (no second compression)
        const blob = await assets.blob(n.assetId);
        if (blob?.mime === 'image/jpeg') return { bytes: blob.bytes, mime: 'image/jpeg' };
      }
      const c = assets.rendered(n.assetId, n.adjustments, false, docColour(doc.settings).bitDepth === 16);
      return c ? canvasImage(c, o.quality) : null;
    },
    assetImage: async (id) => {
      const blob = await assets.blob(id);
      if (blob?.mime === 'image/jpeg') return { bytes: blob.bytes, mime: 'image/jpeg' };
      const c = assets.get(id);
      return c ? canvasImage(c, o.quality) : null;
    },
    rasterise: async (n: SceneNode, ppu: number) => {
      const b = renderLocalBounds(n);
      const sw = 'stroke' in n && n.stroke.width > 0 ? n.stroke.width : 0;
      const pad = sw / 2 + 2;
      const box = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
      const k = Math.min(ppu, 8000 / Math.max(box.w, box.h, 1));
      const c = createCanvas(Math.max(1, Math.ceil(box.w * k)), Math.max(1, Math.ceil(box.h * k)));
      const ctx = ctx2d(c);
      ctx.scale(k, k);
      ctx.translate(-box.x, -box.y);
      drawNodeContent(ctx, n, { doc, assets, editor: false, preview: false, zoom: k });
      return { bytes: await canvasToBytes(c, 'image/png'), mime: 'image/png', box };
    },
  });
}

/** Does any of these pages hold photos or pixel layers (where JPEG quality matters)? */
export function pagesHaveImages(doc: QuvreloDocument, pages: number[]): boolean {
  const visit = (nodes: SceneNode[]): boolean => nodes.some((n) => n.visible && (n.type === 'raster' || (n.type === 'imageframe' && !!n.assetId) || (n.type === 'group' && visit(n.children))));
  return pages.some((i) => {
    const p = doc.pages[i];
    if (!p) return false;
    const m = p.masterId ? doc.masters.find((x) => x.id === p.masterId) : null;
    return visit(p.nodes) || (!!m && visit(m.nodes));
  });
}
