/**
 * Vector PDF writer (pdf-lib, MIT). Shapes, paths, strokes, gradients, clipping
 * masks and text are written as real PDF vectors and text with embedded,
 * subsetted fonts, so they stay sharp at any zoom and the text can be searched
 * and copied. Pixel layers and placed images are embedded once each at their
 * own resolution.
 *
 * What PDF cannot express the way the canvas draws it (a gradient with
 * transparent stops, a gradient stroke, text in a font that cannot be embedded
 * or missing glyphs, a synthetic bold) is drawn by the canvas renderer for that
 * one object and placed as an image at `fallbackDpi`; the report lists each one
 * so the dialog can say so.
 *
 * The canvas renderer is the reference: opacity multiplies down the tree and a
 * group's blend mode applies to its children (no isolated transparency groups),
 * fills use the even-odd rule, and text is placed line by line using the same
 * measurements and flow as the editor.
 *
 * Pure apart from pdf-lib: everything that needs a canvas or font files comes in
 * through `VectorPdfHooks`, so it runs (and is tested) in Node.
 */
import { PDFDict, PDFDocument, PDFName, PDFString, type PDFFont, type PDFImage, type PDFRef } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { composeTransform, type Matrix } from './geometry';
import { nodeToPath } from './document';
import { lineHeightPx, type FlowResult, type MeasureFn } from './textflow';
import { baselineOffset, imageFrameContentRect } from './svg';
import { firstFamily } from './pdfFonts';
import { otFeatures } from './otFeatures';
import { drawnStyle, type LaidOutLine } from './textflow';
import { masterItemsFor } from './layout';
import { isCovered, layoutCell } from './tables';
import { docPxPerInch, pdfPtPerPx } from './units';
import type { BlendMode, Id, Paint, PathCommand, QuvreloDocument, SceneNode, Stroke, TextStyle } from './types';

export interface PdfFontFace {
  /** cache key: the same face is embedded once */
  key: string;
  bytes: Uint8Array;
  /** the face is upright but the style asks for italic (the browser slants it, so do we) */
  synthItalic: boolean;
}

export interface PdfImageData {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
}

export interface PdfRasterData extends PdfImageData {
  /** placement in the node's local space */
  box: { x: number; y: number; w: number; h: number };
}

export interface VectorPdfHooks {
  measure: MeasureFn;
  /** artistic text block size (same metrics as the canvas) */
  textSize: (text: string, style: TextStyle) => { w: number; h: number };
  /** laid-out story (same flow as the canvas); pageIndex = page a master item is drawn on (fields) */
  flow: (storyId: Id, pageIndex?: number) => FlowResult | null;
  /** font file for a text style, or why it cannot be embedded */
  font: (style: TextStyle) => Promise<PdfFontFace | string>;
  /** pixels of a pixel layer with its adjustments, at its own resolution */
  rasterPixels: (node: Extract<SceneNode, { type: 'raster' }>) => Promise<PdfImageData | null>;
  /** a placed image at its own resolution */
  assetImage: (assetId: Id) => Promise<PdfImageData | null>;
  /** the node's content (local space, no transform/opacity) drawn by the canvas renderer */
  rasterise: (node: SceneNode, pxPerUnit: number) => Promise<PdfRasterData | null>;
}

export interface VectorPdfOptions {
  pages: number[];
  includeBleed: boolean;
  cropMarks: boolean;
  /** resolution for objects that have to be placed as images */
  fallbackDpi: number;
  title?: string;
}

export interface VectorPdfReport {
  pages: number;
  vectorObjects: number;
  textObjects: number;
  images: number;
  /** objects drawn as images, with why */
  rasterised: { name: string; reason: string }[];
}

const MARK_PX = 24;

// ---------------------------------------------------------------------------
// small pure helpers (exported for tests)

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080',
  orange: '#ffa500', purple: '#800080', navy: '#000080', teal: '#008080',
};

/** CSS colour → 0..1 RGBA. Hex (3/4/6/8), rgb()/rgba(), a few names, transparent. */
export function parseCssColor(input: string): Rgba | null {
  let s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED[s]) s = NAMED[s];
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: v(0), g: v(2), b: v(4), a: h.length === 8 ? v(6) : 1 };
  }
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a };
    if ([out.r, out.g, out.b, out.a].some((v) => !Number.isFinite(v))) return null;
    const c = (v: number) => Math.min(1, Math.max(0, v));
    return { r: c(out.r), g: c(out.g), b: c(out.b), a: c(out.a) };
  }
  return null;
}

/** Path commands → PDF path operators (quadratics become cubics). */
export function pathOps(d: PathCommand[]): string {
  const out: string[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const c of d) {
    switch (c[0]) {
      case 'M':
        cx = sx = c[1];
        cy = sy = c[2];
        out.push(`${fmt(cx)} ${fmt(cy)} m`);
        break;
      case 'L':
        cx = c[1];
        cy = c[2];
        out.push(`${fmt(cx)} ${fmt(cy)} l`);
        break;
      case 'C':
        out.push(`${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])} c`);
        cx = c[5];
        cy = c[6];
        break;
      case 'Q': {
        const [, qx, qy, x, y] = c;
        const c1x = cx + (2 / 3) * (qx - cx);
        const c1y = cy + (2 / 3) * (qy - cy);
        const c2x = x + (2 / 3) * (qx - x);
        const c2y = y + (2 / 3) * (qy - y);
        out.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x)} ${fmt(y)} c`);
        cx = x;
        cy = y;
        break;
      }
      case 'Z':
        out.push('h');
        cx = sx;
        cy = sy;
        break;
    }
  }
  return out.join('\n');
}

const BLEND_PDF: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten',
  'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight',
  difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

type Box = { x: number; y: number; w: number; h: number };

/** Gradient geometry in the node's local space, matching the canvas renderer. */
export function gradientCoords(p: Extract<Paint, { type: 'linear' | 'radial' }>, box: Box): number[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (p.type === 'linear') {
    const a = (p.angle * Math.PI) / 180;
    const dx = (Math.cos(a) * box.w) / 2;
    const dy = (Math.sin(a) * box.h) / 2;
    return [cx - dx, cy - dy, cx + dx, cy + dy];
  }
  return [cx, cy, 0, cx, cy, Math.max(box.w, box.h) / 2];
}

function pathBox(d: PathCommand[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of d) {
    for (let i = 1; i < c.length; i += 2) {
      const x = c[i] as number;
      const y = c[i + 1] as number;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Why a paint cannot be written as PDF vector paint (null = it can). */
function paintProblem(p: Paint): string | null {
  if (p.type === 'none') return null;
  if (p.type === 'solid') return parseCssColor(p.color) ? null : `colour “${p.color}”`;
  if (p.stops.length < 1) return 'empty gradient';
  for (const s of p.stops) {
    const c = parseCssColor(s.color);
    if (!c) return `colour “${s.color}”`;
    if (c.a < 1) return 'gradient with transparency';
  }
  return null;
}

// ---------------------------------------------------------------------------
// writer

interface Gfx {
  alpha: number;
  blend: BlendMode;
}

class PageWriter {
  ops: string[] = [];
  constructor(private w: Writer, readonly res: PDFDict) {}

  push(s: string) {
    this.ops.push(s);
  }

  private resKey(kind: 'ExtGState' | 'Shading' | 'XObject' | 'Font', prefix: string, ref: PDFRef): string {
    let sub = this.res.lookupMaybe(PDFName.of(kind), PDFDict);
    if (!sub) {
      sub = this.w.pdf.context.obj({}) as PDFDict;
      this.res.set(PDFName.of(kind), sub);
    }
    for (const [k, v] of sub.entries()) if (v === ref) return k.asString();
    let i = sub.entries().length + 1;
    while (sub.has(PDFName.of(`${prefix}${i}`))) i++;
    const name = PDFName.of(`${prefix}${i}`);
    sub.set(name, ref);
    return name.asString();
  }

  gs(g: Gfx) {
    const ref = this.w.extGState(g.alpha, g.blend);
    if (ref) this.push(`${this.resKey('ExtGState', 'GS', ref)} gs`);
  }
  shading(ref: PDFRef) {
    return this.resKey('Shading', 'Sh', ref);
  }
  xobject(ref: PDFRef) {
    return this.resKey('XObject', 'Im', ref);
  }
  font(ref: PDFRef) {
    return this.resKey('Font', 'F', ref);
  }
}

class Writer {
  report: VectorPdfReport = { pages: 0, vectorObjects: 0, textObjects: 0, images: 0, rasterised: [] };
  private gsCache = new Map<string, PDFRef>();
  private imageCache = new Map<string, PDFImage | null>();
  private fontCache = new Map<string, Promise<PDFFont | null>>();
  /** page being written (page-number fields in master items) */
  pageIndex = 0;
  constructor(public pdf: PDFDocument, public doc: QuvreloDocument, public hooks: VectorPdfHooks, public opts: VectorPdfOptions) {}

  extGState(alpha: number, blend: BlendMode): PDFRef | null {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
    const key = `${a}|${blend}`;
    let ref = this.gsCache.get(key);
    if (!ref) {
      ref = this.pdf.context.register(this.pdf.context.obj({ Type: 'ExtGState', ca: a, CA: a, BM: BLEND_PDF[blend] }));
      this.gsCache.set(key, ref);
    }
    return ref;
  }

  async image(key: string, load: () => Promise<PdfImageData | null>): Promise<PDFImage | null> {
    if (this.imageCache.has(key)) return this.imageCache.get(key)!;
    const data = await load();
    let img: PDFImage | null = null;
    if (data) {
      img = data.mime === 'image/jpeg' ? await this.pdf.embedJpg(data.bytes) : await this.pdf.embedPng(data.bytes);
      this.report.images++;
    }
    this.imageCache.set(key, img);
    return img;
  }

  /** Embed a face once per OpenType feature set (ligatures, figures… shaped by fontkit like the canvas). */
  font(face: PdfFontFace, features: Record<string, boolean> = {}): Promise<PDFFont | null> {
    const fk = Object.keys(features).length ? `${face.key}|${JSON.stringify(features)}` : face.key;
    let f = this.fontCache.get(fk);
    if (!f) {
      f = this.pdf.embedFont(face.bytes, Object.keys(features).length ? { subset: true, features } : { subset: true }).catch(() => null);
      this.fontCache.set(fk, f);
    }
    return f;
  }

  shadingFor(p: Extract<Paint, { type: 'linear' | 'radial' }>, box: Box): PDFRef {
    const ctx = this.pdf.context;
    const stops = [...p.stops].sort((a, b) => a.offset - b.offset).map((s) => {
      const c = parseCssColor(s.color)!;
      return { o: Math.min(1, Math.max(0, s.offset)), c: [c.r, c.g, c.b] };
    });
    // pad to the ends, like canvas gradients
    if (stops[0].o > 0) stops.unshift({ o: 0, c: stops[0].c });
    if (stops[stops.length - 1].o < 1) stops.push({ o: 1, c: stops[stops.length - 1].c });
    const segs = [];
    for (let i = 0; i < stops.length - 1; i++) segs.push({ FunctionType: 2, Domain: [0, 1], C0: stops[i].c, C1: stops[i + 1].c, N: 1 });
    const fn = segs.length === 1
      ? segs[0]
      : {
        FunctionType: 3,
        Domain: [0, 1],
        Functions: segs,
        Bounds: stops.slice(1, -1).map((s) => s.o),
        Encode: segs.flatMap(() => [0, 1]),
      };
    const coords = gradientCoords(p, box);
    return ctx.register(ctx.obj({
      ShadingType: p.type === 'linear' ? 2 : 3,
      ColorSpace: 'DeviceRGB',
      Coords: coords,
      Function: fn,
      Extend: [true, true],
    }));
  }
}

function colorOp(c: Rgba, stroke: boolean): string {
  return `${fmt(c.r)} ${fmt(c.g)} ${fmt(c.b)} ${stroke ? 'RG' : 'rg'}`;
}

function matrixOp(m: Matrix): string {
  return `${m.map(fmt).join(' ')} cm`;
}

/** Fill the current path definition `path` with paint `p` (solid or gradient). */
function fillPath(pw: PageWriter, w: Writer, path: string, p: Paint, box: Box, g: Gfx, evenOdd = true) {
  if (p.type === 'none') return;
  if (p.type === 'solid') {
    const c = parseCssColor(p.color)!;
    if (c.a <= 0) return;
    pw.push('q');
    pw.gs({ alpha: g.alpha * c.a, blend: g.blend });
    pw.push(colorOp(c, false));
    pw.push(path);
    pw.push(evenOdd ? 'f*' : 'f');
    pw.push('Q');
    return;
  }
  pw.push('q');
  pw.gs(g);
  pw.push(path);
  pw.push(evenOdd ? 'W* n' : 'W n');
  pw.push(`${pw.shading(w.shadingFor(p, box))} sh`);
  pw.push('Q');
}

function strokePath(pw: PageWriter, path: string, s: Stroke, g: Gfx) {
  if (s.width <= 0 || s.paint.type !== 'solid') return;
  const c = parseCssColor(s.paint.color)!;
  if (c.a <= 0) return;
  pw.push('q');
  pw.gs({ alpha: g.alpha * c.a, blend: g.blend });
  pw.push(colorOp(c, true));
  pw.push(`${fmt(s.width)} w ${s.cap === 'round' ? 1 : s.cap === 'square' ? 2 : 0} J ${s.join === 'round' ? 1 : s.join === 'bevel' ? 2 : 0} j 10 M`);
  pw.push(`[${s.dash.map(fmt).join(' ')}] 0 d`);
  pw.push(path);
  pw.push('S');
  pw.push('Q');
}

function strokeProblem(s: Stroke): string | null {
  if (s.width <= 0 || s.paint.type === 'none') return null;
  if (s.paint.type !== 'solid') return 'gradient stroke';
  return paintProblem(s.paint);
}

function rectPathOps(b: Box): string {
  return `${fmt(b.x)} ${fmt(b.y)} ${fmt(b.w)} ${fmt(b.h)} re`;
}

/** Characters of `text` the font cannot draw. */
function missingGlyphs(font: PDFFont, text: string): string[] {
  const set = new Set(font.getCharacterSet());
  const miss: string[] = [];
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const cp = ch.codePointAt(0)!;
    if (!set.has(cp) && !miss.includes(ch)) miss.push(ch);
  }
  return miss;
}

interface TextRun {
  text: string;
  x: number;
  y: number;
  wordSpacing: number;
  underlineW: number;
}

/** Laid-out lines (styled runs) as text runs grouped by style, in frame-local coordinates (origin = top-left at ox, oy). */
function runsByStyle(lines: LaidOutLine[], fallback: TextStyle, ox: number, oy: number): { style: TextStyle; runs: TextRun[] }[] {
  const groups = new Map<TextStyle, TextRun[]>();
  for (const l of lines) {
    const base = l.baseline ?? l.y + baselineOffset(fallback);
    const rs = l.runs ?? [{ text: l.text, x: l.x, width: l.width, style: fallback, start: l.start, end: l.end, wordSpacing: l.wordSpacing, rise: 0 }];
    for (const r of rs) {
      if (!r.text) continue;
      const ds = drawnStyle(r.style);
      let list = groups.get(ds);
      if (!list) {
        list = [];
        groups.set(ds, list);
      }
      list.push({ text: r.text, x: ox + r.x, y: oy + base - r.rise, wordSpacing: r.wordSpacing, underlineW: r.width });
    }
  }
  return [...groups.entries()].map(([style, runs]) => ({ style, runs }));
}

/** Write runs of text in one style. Returns why not when the text has to be placed as an image. */
async function writeText(
  pw: PageWriter, w: Writer, runs: TextRun[], style: TextStyle, stroke: Stroke | null, g: Gfx,
): Promise<string | null> {
  const fillProblem = paintProblem(style.fill);
  if (fillProblem) return fillProblem;
  if (style.fill.type !== 'solid' && style.fill.type !== 'none') return 'gradient text';
  // small caps are a font feature pdf-lib cannot shape: the canvas draws that text
  if (style.caps && style.caps !== 'normal') return 'small caps';
  const sp = stroke ? strokeProblem(stroke) : null;
  if (sp) return sp;
  const face = await w.hooks.font(style);
  if (typeof face === 'string') return face;
  const font = await w.font(face, otFeatures(style));
  if (!font) return `font “${firstFamily(style.fontFamily)}” could not be embedded`;
  const miss = missingGlyphs(font, runs.map((r) => r.text).join(''));
  if (miss.length) return `characters ${miss.slice(0, 4).join(' ')} are not in the font`;
  const fontName = pw.font(font.ref);
  const tracking = (style.letterSpacing / 1000) * style.fontSize;
  const slant = face.synthItalic ? Math.tan((12 * Math.PI) / 180) : 0;
  const fill = style.fill.type === 'solid' ? parseCssColor(style.fill.color)! : null;
  const strokeC = stroke && stroke.width > 0 && stroke.paint.type === 'solid' ? parseCssColor(stroke.paint.color)! : null;
  const space = w.hooks.measure(' ', style) + tracking;
  const pieces = (r: TextRun): { t: string; x: number }[] => {
    if (!(r.wordSpacing > 0)) return [{ t: r.text, x: r.x }];
    const out: { t: string; x: number }[] = [];
    let cx = r.x;
    for (const word of r.text.split(' ')) {
      out.push({ t: word, x: cx });
      cx += w.hooks.measure(word, style) + tracking * word.length + space + r.wordSpacing;
    }
    return out;
  };
  const pass = (mode: 0 | 1, c: Rgba) => {
    pw.push('q');
    pw.gs({ alpha: g.alpha * c.a, blend: g.blend });
    pw.push(colorOp(c, mode === 1));
    if (mode === 1) pw.push(`${fmt(stroke!.width)} w ${stroke!.join === 'round' ? 1 : stroke!.join === 'bevel' ? 2 : 0} j 10 M`);
    pw.push('BT');
    pw.push(`${fontName} ${fmt(style.fontSize)} Tf ${fmt(tracking)} Tc ${mode} Tr`);
    for (const r of runs) {
      for (const p of pieces(r)) {
        if (!p.t) continue;
        pw.push(`1 0 ${fmt(slant)} -1 ${fmt(p.x)} ${fmt(r.y)} Tm`);
        pw.push(`${font.encodeText(p.t).toString()} Tj`);
      }
    }
    pw.push('ET');
    pw.push('Q');
  };
  if (strokeC && strokeC.a > 0) pass(1, strokeC);
  if (fill && fill.a > 0) {
    pass(0, fill);
    if (style.underline || style.strike) {
      const t = Math.max(1, style.fontSize / 16);
      pw.push('q');
      pw.gs({ alpha: g.alpha * fill.a, blend: g.blend });
      pw.push(colorOp(fill, false));
      for (const r of runs) {
        if (r.underlineW <= 0) continue;
        if (style.underline) pw.push(`${fmt(r.x)} ${fmt(r.y + style.fontSize * 0.12)} ${fmt(r.underlineW)} ${fmt(t)} re f`);
        if (style.strike) pw.push(`${fmt(r.x)} ${fmt(r.y - style.fontSize * 0.28)} ${fmt(r.underlineW)} ${fmt(t)} re f`);
      }
      pw.push('Q');
    }
  }
  return null;
}

/** Place the canvas rendering of a node's content (local space) as an image. */
async function writeRasterised(pw: PageWriter, w: Writer, n: SceneNode, g: Gfx, reason: string): Promise<void> {
  const ppu = w.opts.fallbackDpi / docPxPerInch(w.doc.settings);
  const r = await w.hooks.rasterise(n, ppu);
  w.report.rasterised.push({ name: n.name || n.type, reason });
  if (!r) return;
  const img = await w.image(`fallback:${n.id}:${w.report.rasterised.length}`, async () => r);
  if (!img) return;
  pw.push('q');
  pw.gs(g);
  pw.push(`${fmt(r.box.w)} 0 0 ${fmt(-r.box.h)} ${fmt(r.box.x)} ${fmt(r.box.y + r.box.h)} cm`);
  pw.push(`${pw.xobject(img.ref)} Do`);
  pw.push('Q');
}

async function writeImageAt(pw: PageWriter, img: PDFImage, b: Box, g: Gfx) {
  pw.push('q');
  pw.gs(g);
  pw.push(`${fmt(b.w)} 0 0 ${fmt(-b.h)} ${fmt(b.x)} ${fmt(b.y + b.h)} cm`);
  pw.push(`${pw.xobject(img.ref)} Do`);
  pw.push('Q');
}

async function writeNode(pw: PageWriter, w: Writer, n: SceneNode, parent: Gfx): Promise<void> {
  if (!n.visible) return;
  const g: Gfx = { alpha: parent.alpha * n.opacity, blend: n.blend !== 'normal' ? n.blend : parent.blend };
  if (g.alpha <= 0) return;
  pw.push('q');
  pw.push(matrixOp(composeTransform(n)));
  if (n.mask?.enabled && n.mask.d.length) {
    const clip = pathOps(n.mask.d);
    if (n.mask.inverted) pw.push(`-1000000 -1000000 2000000 2000000 re\n${clip}\nW* n`);
    else pw.push(`${clip}\nW* n`);
  }
  await writeContent(pw, w, n, g);
  pw.push('Q');
}

async function writeContent(pw: PageWriter, w: Writer, n: SceneNode, g: Gfx): Promise<void> {
  switch (n.type) {
    case 'rect':
    case 'ellipse':
    case 'polygon':
    case 'star':
    case 'path': {
      const problem = paintProblem(n.fill) ?? strokeProblem(n.stroke);
      if (problem) return writeRasterised(pw, w, n, g, problem);
      const d = nodeToPath(n) ?? [];
      const path = pathOps(d);
      const box = n.type === 'path' ? pathBox(d) : { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
      if (n.type !== 'path' || n.closed || n.fill.type !== 'none') fillPath(pw, w, path, n.fill, box, g);
      strokePath(pw, path, n.stroke, g);
      w.report.vectorObjects++;
      return;
    }
    case 'text': {
      const s = n.style;
      const size = w.hooks.textSize(n.text, s);
      const lh = lineHeightPx(s);
      const box = { x: -size.w / 2, y: -size.h / 2, w: size.w, h: size.h };
      const tracking = (s.letterSpacing / 1000) * s.fontSize;
      const runs: TextRun[] = n.text.split('\n').map((line, i) => {
        const lw = w.hooks.measure(line, s) + tracking * line.length;
        let x = box.x;
        if (s.align === 'center') x = -lw / 2;
        else if (s.align === 'right') x = box.x + box.w - lw;
        return { text: line, x, y: box.y + i * lh + baselineOffset(s), wordSpacing: 0, underlineW: lw };
      });
      const problem = await writeText(pw, w, runs, s, n.stroke, g);
      if (problem) return writeRasterised(pw, w, n, g, problem);
      w.report.textObjects++;
      return;
    }
    case 'textframe': {
      const box = { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
      const story = w.doc.stories[n.storyId];
      const flow = story ? w.hooks.flow(n.storyId, w.pageIndex) : null;
      const layout = flow?.frames[n.id];
      // styled runs (paragraph / character styles), one text object per style
      const groups = story && layout ? runsByStyle(layout.lines, story.style, box.x, box.y) : [];
      const problem = paintProblem(n.fill) ?? strokeProblem(n.stroke);
      if (problem) return writeRasterised(pw, w, n, g, problem);
      // dry run the text into a scratch writer so a fallback never leaves half a frame behind
      const scratch = new PageWriter(w, pw.res);
      let textProblem: string | null = null;
      for (const grp of groups) {
        textProblem = await writeText(scratch, w, grp.runs, grp.style, null, g);
        if (textProblem) break;
      }
      if (textProblem) return writeRasterised(pw, w, n, g, textProblem);
      // same order as the canvas: frame fill, frame stroke, then the clipped text
      const rect = rectPathOps(box);
      fillPath(pw, w, rect, n.fill, box, g);
      strokePath(pw, rect, n.stroke, g);
      if (scratch.ops.length) {
        pw.push('q');
        pw.push(`${rectPathOps({ x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 })} W n`);
        for (const op of scratch.ops) pw.push(op);
        pw.push('Q');
      }
      w.report.textObjects++;
      return;
    }
    case 'table': {
      // cell fills, text (per style) and borders as vectors; any unsupported paint places the table as an image
      const sheet = w.doc.textStyles ?? { paragraph: [], character: [], cell: [] };
      const ox = -n.w / 2;
      const oy = -n.h / 2;
      const cells: ReturnType<typeof layoutCell>[] = [];
      for (let r = 0; r < n.rowHeights.length; r++) for (let c = 0; c < n.colWidths.length; c++) {
        if (!isCovered(n, r, c)) cells.push(layoutCell(n, sheet, r, c, w.hooks.measure));
      }
      for (const cl of cells) {
        const p = paintProblem(cl.props.fill) ?? (cl.props.strokeWidth > 0 ? paintProblem(cl.props.stroke) : null);
        if (p) return writeRasterised(pw, w, n, g, p);
      }
      const scratch = new PageWriter(w, pw.res);
      for (const cl of cells) {
        const box = { x: ox + cl.rect.x, y: oy + cl.rect.y, w: cl.rect.w, h: cl.rect.h };
        fillPath(scratch, w, rectPathOps(box), cl.props.fill, box, g);
      }
      for (const cl of cells) {
        const box = { x: ox + cl.rect.x, y: oy + cl.rect.y, w: cl.rect.w, h: cl.rect.h };
        const groups = runsByStyle(cl.flow.frames.cell?.lines ?? [], cl.style, box.x, box.y);
        if (!groups.length) continue;
        scratch.push('q');
        scratch.push(`${rectPathOps(box)} W n`);
        for (const grp of groups) {
          const tp = await writeText(scratch, w, grp.runs, grp.style, null, g);
          if (tp) return writeRasterised(pw, w, n, g, tp);
        }
        scratch.push('Q');
      }
      for (const cl of cells) {
        if (cl.props.strokeWidth <= 0 || cl.props.stroke.type === 'none') continue;
        const box = { x: ox + cl.rect.x, y: oy + cl.rect.y, w: cl.rect.w, h: cl.rect.h };
        strokePath(scratch, rectPathOps(box), { paint: cl.props.stroke, width: cl.props.strokeWidth, dash: [], cap: 'butt', join: 'miter' }, g);
      }
      for (const op of scratch.ops) pw.push(op);
      w.report.vectorObjects++;
      return;
    }
    case 'imageframe': {
      const problem = paintProblem(n.fill) ?? strokeProblem(n.stroke);
      if (problem) return writeRasterised(pw, w, n, g, problem);
      const box = { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h };
      const rect = rectPathOps(box);
      pw.push('q');
      pw.push(`${rect} W n`);
      fillPath(pw, w, rect, n.fill, box, g);
      const meta = n.assetId ? w.doc.assets[n.assetId] : null;
      if (n.assetId && meta) {
        const id = n.assetId;
        const img = await w.image(`asset:${id}`, () => w.hooks.assetImage(id));
        if (img) await writeImageAt(pw, img, imageFrameContentRect(n, meta.width || img.width, meta.height || img.height), g);
      }
      pw.push('Q');
      strokePath(pw, rect, n.stroke, g);
      w.report.vectorObjects++;
      return;
    }
    case 'raster': {
      const key = `raster:${n.assetId}:${JSON.stringify(n.adjustments.filter((a) => a.enabled))}`;
      const img = await w.image(key, () => w.hooks.rasterPixels(n));
      if (img) await writeImageAt(pw, img, { x: -n.w / 2, y: -n.h / 2, w: n.w, h: n.h }, g);
      return;
    }
    case 'group':
      for (const c of n.children) await writeNode(pw, w, c, g);
      return;
  }
}

/** Write the chosen pages as a vector PDF. */
export async function exportVectorPdf(
  doc: QuvreloDocument, opts: VectorPdfOptions, hooks: VectorPdfHooks,
): Promise<{ bytes: Uint8Array; report: VectorPdfReport }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(opts.title ?? doc.title);
  pdf.setCreator('Quvrelo');
  pdf.setProducer('Quvrelo (pdf-lib)');
  const now = new Date();
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  const w = new Writer(pdf, doc, hooks, opts);
  const { width, height, background } = doc.settings;
  const bleed = opts.includeBleed ? doc.settings.bleed : 0;
  // page size from the document's own scale: 96 px/in for print units, Output DPI for a px document
  const PT_PER_PX = pdfPtPerPx(doc.settings);
  const pxScale = docPxPerInch(doc.settings) / 96;
  const mark = opts.cropMarks ? MARK_PX * pxScale : 0;
  for (const i of opts.pages) {
    const page = doc.pages[i];
    if (!page) continue;
    const wPx = width + 2 * bleed;
    const hPx = height + 2 * bleed;
    const pageW = (wPx + 2 * mark) * PT_PER_PX;
    const pageH = (hPx + 2 * mark) * PT_PER_PX;
    const p = pdf.addPage([pageW, pageH]);
    const res = p.node.Resources() ?? (pdf.context.obj({}) as PDFDict);
    p.node.set(PDFName.of('Resources'), res);
    const pw = new PageWriter(w, res);
    // document space: px, y down, origin at the trim corner
    pw.push('q');
    pw.push(`${fmt(PT_PER_PX)} 0 0 ${fmt(-PT_PER_PX)} ${fmt((mark + bleed) * PT_PER_PX)} ${fmt(pageH - (mark + bleed) * PT_PER_PX)} cm`);
    const base: Gfx = { alpha: 1, blend: 'normal' };
    if (background) {
      const c = parseCssColor(background);
      if (c && c.a > 0) {
        pw.push('q');
        if (c.a < 1) pw.gs({ alpha: c.a, blend: 'normal' });
        pw.push(colorOp(c, false));
        pw.push(`${rectPathOps({ x: -bleed, y: -bleed, w: wPx, h: hPx })} f`);
        pw.push('Q');
      }
    }
    w.pageIndex = i;
    // master items not overridden on this page, then the page's own items
    for (const n of masterItemsFor(doc, page)) await writeNode(pw, w, n, base);
    for (const n of page.nodes) await writeNode(pw, w, n, base);
    pw.push('Q');
    // page boxes so print shops find trim and bleed
    const trim = [(mark + bleed) * PT_PER_PX, (mark + bleed) * PT_PER_PX, (mark + bleed + width) * PT_PER_PX, (mark + bleed + height) * PT_PER_PX];
    p.node.set(PDFName.of('TrimBox'), pdf.context.obj(trim));
    p.node.set(PDFName.of('BleedBox'), pdf.context.obj([mark * PT_PER_PX, mark * PT_PER_PX, (mark + wPx) * PT_PER_PX, (mark + hPx) * PT_PER_PX]));
    if (opts.cropMarks) {
      const [x0, y0, x1, y1] = trim;
      const off = (bleed + 4 * pxScale) * PT_PER_PX;
      const len = 14;
      pw.push('q 0 0 0 RG 0.3 w 0 J [] 0 d');
      for (const [x, sx] of [[x0, -1], [x1, 1]] as const) {
        for (const [y, sy] of [[y0, -1], [y1, 1]] as const) {
          pw.push(`${fmt(x + sx * off)} ${fmt(y)} m ${fmt(x + sx * (off + len))} ${fmt(y)} l S`);
          pw.push(`${fmt(x)} ${fmt(y + sy * off)} m ${fmt(x)} ${fmt(y + sy * (off + len))} l S`);
        }
      }
      pw.push('Q');
    }
    const stream = pdf.context.flateStream(pw.ops.join('\n'));
    p.node.set(PDFName.of('Contents'), pdf.context.register(stream));
    w.report.pages++;
  }
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('en'));
  const bytes = await pdf.save();
  return { bytes, report: w.report };
}

