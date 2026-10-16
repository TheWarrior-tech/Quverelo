/**
 * InDesign Markup Language (IDML) import.
 *
 * IDML is a zip of XML parts (Adobe publishes the format specification). We
 * read designmap.xml, Preferences, Graphic (colours and tints), Styles
 * (paragraph and character styles with BasedOn inheritance), Stories, Spreads
 * and MasterSpreads, and map them onto the document model:
 *  - pages (size, margins, columns), facing pages, master spreads -> masters
 *  - text frames -> text frames, threaded in story order (Previous/NextTextFrame),
 *    with columns, gutter and inset; story text keeps paragraph breaks
 *  - paragraph/character styles are resolved (font, size, weight, italic,
 *    leading, tracking, alignment, colour, underline) onto the story style;
 *    the model holds one style per story, so mixed styling is reported
 *  - rectangles / ovals / polygons / lines / groups -> editable shapes
 *  - placed images -> picture frames (embedded images always; linked images
 *    when the caller's resolver can read the linked file)
 *  - named colours -> document swatches
 */
import JSZip from 'jszip';
import { createDocument, createMaster, createStory, defaultTextStyle, make, makeStroke, NO_PAINT, solid } from '../document';
import { decompose, invert, multiply, type Matrix } from '../geometry';
import { newId } from '../ids';
import { centrePath } from '../path';
import type { Id, MasterPage, Page, Paint, PathCommand, SceneNode, Stroke, Story, Swatch, TextAlign, TextStyle } from '../types';
import { cmykToHex, labToHex, rgbHex } from './color';
import { emptyResult, summariseWarnings, type ImportResult } from './types';
import { child, elements, findAll, parseXml, textOf, type XmlElement } from './xml';

export const PX_PER_PT = 96 / 72;

/** Reads a linked image (absolute path or file: URI) and returns its bytes, or null. */
export type LinkResolver = (uri: string) => Promise<Uint8Array | null>;

// ---------------------------------------------------------------------------
// Helpers

const cat = (a: Matrix, b: Matrix): Matrix => multiply(b, a); // apply a, then b
const ap = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const nums = (s: string | undefined): number[] => (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
const matrixOf = (s: string | undefined): Matrix => {
  const v = nums(s);
  return v.length === 6 ? (v as Matrix) : [1, 0, 0, 1, 0, 0];
};

/** Width/height of a PNG or JPEG from its header (no decoding). */
export function imageSize(b: Uint8Array): { width: number; height: number; mime: string } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), mime: 'image/png' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], mime: 'image/jpeg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, 'base64'));
}

/** <Properties><Name type="…">value</Name></Properties> */
function prop(e: XmlElement, name: string): string | undefined {
  const p = child(e, 'Properties');
  const n = p && child(p, name);
  return n ? textOf(n).trim() : undefined;
}

// ---------------------------------------------------------------------------
// Colours

class Colours {
  map = new Map<string, string>();
  swatches: Swatch[] = [];
  constructor(graphic: XmlElement | null) {
    this.map.set('Swatch/None', 'none');
    this.map.set('Color/Paper', '#ffffff');
    this.map.set('Color/Black', '#231f20');
    this.map.set('Color/Registration', '#000000');
    if (!graphic) return;
    for (const c of findAll(graphic, 'Color')) {
      const v = nums(c.attrs.ColorValue);
      let hex: string | null = null;
      if (c.attrs.Space === 'RGB' && v.length >= 3) hex = rgbHex(v[0], v[1], v[2]);
      else if (c.attrs.Space === 'CMYK' && v.length >= 4) hex = cmykToHex(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100);
      else if (c.attrs.Space === 'LAB' && v.length >= 3) hex = labToHex(v[0], v[1], v[2]);
      if (!hex) continue;
      this.map.set(c.attrs.Self, hex);
      const name = c.attrs.Name ?? '';
      if (name && !/^(Registration|Paper|None)$/.test(name) && !name.startsWith('$')) this.swatches.push({ id: newId('sw'), name, color: hex });
    }
    for (const t of findAll(graphic, 'Tint')) {
      const baseHex = this.map.get(t.attrs.BaseColor ?? '');
      const tv = Number(t.attrs.TintValue ?? 100) / 100;
      if (!baseHex || baseHex === 'none') continue;
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(baseHex.slice(k, k + 2), 16));
      this.map.set(t.attrs.Self, rgbHex(255 - (255 - r) * tv, 255 - (255 - g) * tv, 255 - (255 - b) * tv));
    }
    for (const g of findAll(graphic, 'Gradient')) {
      const stops = findAll(g, 'GradientStop').map((s) => this.map.get(s.attrs.StopColor ?? '')).filter((x): x is string => !!x && x !== 'none');
      if (stops.length) this.map.set(g.attrs.Self, stops[0]);
    }
  }
  paint(ref: string | undefined, tint?: string): Paint | null {
    if (ref === undefined) return null;
    let hex = this.map.get(ref);
    if (!hex) return null;
    if (hex === 'none') return NO_PAINT;
    const tv = tint !== undefined && Number(tint) >= 0 ? Number(tint) / 100 : 1;
    if (tv < 1) {
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex!.slice(k, k + 2), 16));
      hex = rgbHex(255 - (255 - r) * tv, 255 - (255 - g) * tv, 255 - (255 - b) * tv);
    }
    return solid(hex);
  }
}

// ---------------------------------------------------------------------------
// Styles

type StyleAttrs = Record<string, string>;

/** Flatten an element's style-relevant attributes and <Properties> (AppliedFont, Leading, BasedOn). */
function styleAttrs(e: XmlElement): StyleAttrs {
  const out: StyleAttrs = { ...e.attrs };
  for (const k of ['AppliedFont', 'Leading', 'BasedOn']) {
    const v = prop(e, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

class Styles {
  private para = new Map<string, XmlElement>();
  private char = new Map<string, XmlElement>();
  constructor(styles: XmlElement | null) {
    if (!styles) return;
    for (const p of findAll(styles, 'ParagraphStyle')) this.para.set(p.attrs.Self, p);
    for (const c of findAll(styles, 'CharacterStyle')) this.char.set(c.attrs.Self, c);
  }
  private chain(map: Map<string, XmlElement>, id: string | undefined, depth = 0): StyleAttrs {
    const e = id ? map.get(id) : undefined;
    if (!e || depth > 20) return {};
    const own = styleAttrs(e);
    return { ...this.chain(map, own.BasedOn, depth + 1), ...own };
  }
  paragraph(id: string | undefined): StyleAttrs { return this.chain(this.para, id); }
  character(id: string | undefined): StyleAttrs { return this.chain(this.char, id); }
}

const ALIGN: Record<string, TextAlign> = {
  LeftAlign: 'left', CenterAlign: 'center', RightAlign: 'right', LeftJustified: 'justify', CenterJustified: 'justify',
  RightJustified: 'justify', FullyJustified: 'justify', ToBindingSide: 'left', AwayFromBindingSide: 'right',
};

export function fontStyleToCss(fontStyle: string | undefined): { weight: number; italic: boolean } {
  const s = (fontStyle ?? 'Regular').toLowerCase();
  const weights: [RegExp, number][] = [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/light/, 300], [/medium/, 500], [/semi ?bold|demi/, 600], [/extra ?bold|ultra ?bold/, 800], [/black|heavy/, 900], [/bold/, 700]];
  return { weight: weights.find(([r]) => r.test(s))?.[1] ?? 400, italic: /italic|oblique/.test(s) };
}

export function resolveTextStyle(a: StyleAttrs, colours: Colours): TextStyle {
  const size = Number(a.PointSize ?? 12) * PX_PER_PT;
  const fs = fontStyleToCss(a.FontStyle);
  const leading = a.Leading && a.Leading !== 'Auto' && Number(a.Leading) > 0 ? (Number(a.Leading) * PX_PER_PT) / size : 1.2;
  const base = defaultTextStyle();
  const fill = colours.paint(a.FillColor, a.FillTint) ?? solid('#231f20');
  return defaultTextStyle({
    fontFamily: a.AppliedFont ? `${a.AppliedFont}, ${base.fontFamily}` : base.fontFamily,
    fontSize: size,
    fontWeight: fs.weight,
    italic: fs.italic,
    underline: a.Underline === 'true',
    lineHeight: leading,
    letterSpacing: Number(a.Tracking ?? 0),
    align: ALIGN[a.Justification ?? 'LeftAlign'] ?? 'left',
    fill,
  });
}

interface ParsedStory { text: string; style: TextStyle; mixed: boolean; paragraphStyles: string[] }

export function parseStory(storyRoot: XmlElement, styles: Styles, colours: Colours): ParsedStory {
  const story = findAll(storyRoot, 'Story')[0] ?? storyRoot;
  let text = '';
  let first: StyleAttrs | null = null;
  const signatures = new Set<string>();
  const paraNames = new Set<string>();
  const visitCsr = (csr: XmlElement, pAttrs: StyleAttrs) => {
    const attrs = { ...pAttrs, ...styles.character(csr.attrs.AppliedCharacterStyle), ...styleAttrs(csr) };
    delete attrs.Self;
    for (const c of csr.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'Content') {
        const t = textOf(c).replace(/\u2028/g, '\n').replace(/\uFEFF/g, '');
        if (t) {
          if (!first) first = attrs;
          signatures.add(JSON.stringify([attrs.PointSize, attrs.FontStyle, attrs.AppliedFont, attrs.FillColor, attrs.Justification, attrs.Leading, attrs.Tracking]));
        }
        text += t;
      } else if (c.name === 'Br') text += '\n';
      else if (c.name === 'Tab') text += '\t';
      else if (c.name === 'HyperlinkTextSource' || c.name === 'XMLElement' || c.name === 'Change') visitCsr({ ...c, attrs: {} }, attrs);
    }
  };
  const visitPsr = (psr: XmlElement) => {
    paraNames.add((psr.attrs.AppliedParagraphStyle ?? '').replace(/^ParagraphStyle\//, '').replace(/^\$ID\//, ''));
    const pAttrs = { ...styles.paragraph(psr.attrs.AppliedParagraphStyle), ...styleAttrs(psr) };
    delete pAttrs.Self;
    for (const c of elements(psr)) {
      if (c.name === 'CharacterStyleRange') visitCsr(c, pAttrs);
      else if (c.name === 'Br') text += '\n';
      else if (c.name === 'XMLElement' || c.name === 'Change') visitPsr({ ...c, attrs: psr.attrs });
    }
  };
  for (const c of elements(story)) {
    if (c.name === 'ParagraphStyleRange') visitPsr(c);
    else if (c.name === 'XMLElement') for (const p of findAll(c, 'ParagraphStyleRange')) visitPsr(p);
  }
  return { text: text.replace(/\n$/, ''), style: resolveTextStyle(first ?? {}, colours), mixed: signatures.size > 1, paragraphStyles: [...paraNames].filter(Boolean) };
}

// ---------------------------------------------------------------------------
// Geometry

interface Geo { d: PathCommand[]; inner: { x: number; y: number; w: number; h: number }; closed: boolean; anchors: number }

/** PathGeometry in item inner coordinates, transformed by `m` (inner -> page px). */
function geometry(e: XmlElement, m: Matrix): Geo | null {
  const pg = findAll(e, 'PathGeometry')[0];
  if (!pg) return null;
  const d: PathCommand[] = [];
  let closed = false;
  let anchors = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const gp of elements(pg, 'GeometryPathType')) {
    const pts = findAll(gp, 'PathPointType').map((p) => ({ a: nums(p.attrs.Anchor), l: nums(p.attrs.LeftDirection), r: nums(p.attrs.RightDirection) }));
    if (!pts.length) continue;
    anchors += pts.length;
    for (const p of pts) { x0 = Math.min(x0, p.a[0]); y0 = Math.min(y0, p.a[1]); x1 = Math.max(x1, p.a[0]); y1 = Math.max(y1, p.a[1]); }
    const T = (v: number[]) => ap(m, v[0], v[1]);
    const a0 = T(pts[0].a);
    d.push(['M', a0[0], a0[1]]);
    const seg = (p: typeof pts[0], q: typeof pts[0]) => {
      const straight = p.r.join() === p.a.join() && q.l.join() === q.a.join();
      const e2 = T(q.a);
      if (straight) d.push(['L', e2[0], e2[1]]);
      else { const c1 = T(p.r), c2 = T(q.l); d.push(['C', c1[0], c1[1], c2[0], c2[1], e2[0], e2[1]]); }
    };
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
    if (gp.attrs.PathOpen !== 'true') {
      seg(pts[pts.length - 1], pts[0]);
      d.push(['Z']);
      closed = true;
    }
  }
  if (!d.length) return null;
  return { d, inner: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, closed, anchors };
}

/** Transform fields for a box node whose inner rect `r` is mapped to page px by `m`. */
function boxTransform(m: Matrix, r: Geo['inner']) {
  const centre = cat([1, 0, 0, 1, r.x + r.w / 2, r.y + r.h / 2], m);
  const t = decompose(centre);
  const w = r.w * t.scaleX, h = r.h * t.scaleY;
  return { ...t, scaleX: 1, scaleY: 1, w: Math.max(1, w), h: Math.max(1, h) };
}

// ---------------------------------------------------------------------------
// Spreads

interface Ctx {
  colours: Colours;
  styles: Styles;
  out: ImportResult;
  warn: (w: string) => void;
  frames: Map<string, { node: Extract<SceneNode, { type: 'textframe' }>; prev: string; next: string; story: string }>;
  images: { node: Extract<SceneNode, { type: 'imageframe' }>; el: XmlElement; frameInner: Matrix }[];
}

interface PageBox { el: XmlElement; toPage: Matrix; target: SceneNode[]; bounds: { x: number; y: number; w: number; h: number } }

function shapeStyle(e: XmlElement, ctx: Ctx): { fill: Paint; stroke: Stroke } {
  const fill = ctx.colours.paint(e.attrs.FillColor, e.attrs.FillTint) ?? NO_PAINT;
  const sp = ctx.colours.paint(e.attrs.StrokeColor, e.attrs.StrokeTint);
  const w = Number(e.attrs.StrokeWeight ?? 1) * PX_PER_PT;
  const stroke: Stroke = sp && sp.type !== 'none' && w > 0 ? { ...makeStroke(), paint: sp, width: w, cap: e.attrs.EndCap === 'RoundEndCap' ? 'round' : e.attrs.EndCap === 'ProjectingEndCap' ? 'square' : 'butt', join: e.attrs.EndJoin === 'RoundEndJoin' ? 'round' : e.attrs.EndJoin === 'BevelEndJoin' ? 'bevel' : 'miter' } : makeStroke();
  if (e.attrs.FillColor && ctx.colours.map.get(e.attrs.FillColor) && /Gradient/.test(e.attrs.FillColor)) ctx.warn('Gradient fills were imported as their first colour');
  return { fill, stroke };
}

function common(e: XmlElement, fallback: string) {
  const opacityEl = findAll(e, 'BlendingSetting')[0];
  const opacity = opacityEl?.attrs.Opacity ? Number(opacityEl.attrs.Opacity) / 100 : 1;
  return { name: e.attrs.Name && e.attrs.Name !== '$ID/' ? e.attrs.Name : fallback, visible: e.attrs.Visible !== 'false', locked: e.attrs.Locked === 'true', opacity };
}

function convertItem(e: XmlElement, parent: Matrix, ctx: Ctx): SceneNode | null {
  const m = cat(matrixOf(e.attrs.ItemTransform), parent); // inner -> page px
  switch (e.name) {
    case 'Group': {
      const kids = elements(e).map((c) => convertItem(c, m, ctx)).filter((n): n is SceneNode => !!n);
      if (!kids.length) return null;
      const xs = kids.map((k) => k.x), ys = kids.map((k) => k.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return make.group(kids.map((k) => ({ ...k, x: k.x - cx, y: k.y - cy })), { ...common(e, 'Group'), x: cx, y: cy });
    }
    case 'TextFrame': {
      const g = geometry(e, m);
      if (!g) return null;
      const bt = boxTransform(m, g.inner);
      const pref = child(e, 'TextFramePreference');
      const inset = nums(pref?.attrs.InsetSpacing ?? prop(pref ?? { name: '', attrs: {}, children: [] }, 'InsetSpacing'));
      const style = shapeStyle(e, ctx);
      const node = make.textframe({
        ...common(e, 'Text Frame'), ...bt, storyId: '', columns: Math.max(1, Number(pref?.attrs.TextColumnCount ?? 1)),
        columnGap: Number(pref?.attrs.TextColumnGutter ?? 12) * PX_PER_PT, padding: (inset[0] ?? 0) * PX_PER_PT, fill: style.fill, stroke: style.stroke,
      });
      if (inset.length > 1 && new Set(inset).size > 1) ctx.warn('Uneven text frame insets were imported as the top inset');
      ctx.frames.set(e.attrs.Self, { node, prev: e.attrs.PreviousTextFrame ?? 'n', next: e.attrs.NextTextFrame ?? 'n', story: e.attrs.ParentStory ?? '' });
      return node;
    }
    case 'Rectangle': case 'Oval': case 'Polygon': case 'GraphicLine': {
      const g = geometry(e, m);
      if (!g) return null;
      const st = shapeStyle(e, ctx);
      const base = common(e, e.name === 'GraphicLine' ? 'Line' : e.name);
      const graphic = elements(e).find((c) => c.name === 'Image' || c.name === 'PDF' || c.name === 'EPS' || c.name === 'ImportedPage');
      if (graphic) {
        const bt = boxTransform(m, g.inner);
        const node = make.imageframe({ ...base, ...bt, fit: 'fill', fill: st.fill, stroke: st.stroke });
        ctx.images.push({ node, el: graphic, frameInner: [1, 0, 0, 1, -(g.inner.x + g.inner.w / 2), -(g.inner.y + g.inner.h / 2)] });
        if (e.name !== 'Rectangle') ctx.warn('Non-rectangular picture frames were imported as rectangles');
        return node;
      }
      if (e.name === 'Rectangle' || e.name === 'Oval') {
        const bt = boxTransform(m, g.inner);
        if (e.name === 'Rectangle' && g.anchors === 4 && g.d.every((c) => c[0] !== 'C')) {
          const radius = e.attrs.TopLeftCornerOption === 'RoundedCorner' ? Number(e.attrs.TopLeftCornerRadius ?? 0) * PX_PER_PT : 0;
          return make.rect({ ...base, ...bt, radius, ...st });
        }
        if (e.name === 'Oval') return make.ellipse({ ...base, ...bt, ...st });
      }
      const c = centrePath(g.d);
      return make.path({ ...base, d: c.d, x: c.cx, y: c.cy, closed: g.closed, ...st });
    }
    default:
      if (['Button', 'MultiStateObject', 'FormField', 'Table'].includes(e.name)) ctx.warn(`${e.name} items were not imported`);
      return null;
  }
}

/** Page boxes of a spread, each with the matrix from spread coordinates to page px. */
function pageBoxes(spread: XmlElement): PageBox[] {
  return elements(spread, 'Page').map((p) => {
    const gb = nums(p.attrs.GeometricBounds); // top left bottom right (page inner)
    const [top, left, bottom, right] = gb.length === 4 ? gb : [0, 0, 792, 612];
    const pageT = matrixOf(p.attrs.ItemTransform);
    const toPage = cat(cat(invert(pageT), [1, 0, 0, 1, -left, -top]), [PX_PER_PT, 0, 0, PX_PER_PT, 0, 0]);
    return { el: p, toPage, target: [], bounds: { x: 0, y: 0, w: (right - left) * PX_PER_PT, h: (bottom - top) * PX_PER_PT } };
  });
}

/** Distribute the spread's page items onto its pages (by item centre). */
function convertSpread(spread: XmlElement, ctx: Ctx): PageBox[] {
  const pages = pageBoxes(spread);
  if (!pages.length) return pages;
  for (const item of elements(spread)) {
    if (item.name === 'Page' || item.name === 'FlattenerPreference' || item.name === 'Properties') continue;
    // decide the page from the item's centre in spread coordinates
    let best = pages[0];
    let bestD = Infinity;
    for (const p of pages) {
      const node = convertItem(item, p.toPage, { ...ctx, frames: new Map(), images: [], warn: () => {} });
      if (!node) continue;
      const dx = Math.max(0, -node.x, node.x - p.bounds.w), dy = Math.max(0, -node.y, node.y - p.bounds.h);
      const dist = dx + dy;
      if (dist < bestD) { bestD = dist; best = p; }
    }
    const node = convertItem(item, best.toPage, ctx);
    if (node) best.target.push(node);
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Entry point

export async function importIdml(bytes: Uint8Array, title: string, resolveLink?: LinkResolver): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(bytes);
  const mimetype = await zip.file('mimetype')?.async('string');
  if (mimetype && !mimetype.includes('indesign-idml')) throw new Error('This is not an InDesign IDML package');
  const read = async (p: string) => {
    const f = zip.file(p);
    return f ? parseXml(await f.async('string')) : null;
  };
  const design = await read('designmap.xml');
  if (!design) throw new Error('designmap.xml is missing — not an IDML file');
  const dm = findAll(design, 'Document')[0] ?? design;
  const refs = (tag: string) => elements(dm, tag).map((e) => e.attrs.src).filter(Boolean);
  const graphic = await read(refs('idPkg:Graphic')[0] ?? 'Resources/Graphic.xml');
  const stylesXml = await read(refs('idPkg:Styles')[0] ?? 'Resources/Styles.xml');
  const prefs = await read(refs('idPkg:Preferences')[0] ?? 'Resources/Preferences.xml');
  const colours = new Colours(graphic);
  const styles = new Styles(stylesXml);
  const warnings: string[] = [];

  const docPref = prefs ? findAll(prefs, 'DocumentPreference')[0] : undefined;
  const ctxBase = { colours, styles, warn: (w: string) => warnings.push(w) };

  // masters
  const masterPages: { id: Id; spreadId: string; index: number; master: MasterPage }[] = [];
  const tmpOut = emptyResult(createDocument());
  const ctx: Ctx = { ...ctxBase, out: tmpOut, frames: new Map(), images: [] };
  for (const src of refs('idPkg:MasterSpread')) {
    const x = await read(src);
    const ms = x && findAll(x, 'MasterSpread')[0];
    if (!ms) continue;
    const name = `${ms.attrs.NamePrefix ?? ''}-${ms.attrs.BaseName ?? 'Master'}`;
    const boxes = convertSpread(ms, ctx);
    boxes.forEach((b, i) => {
      const m = createMaster(boxes.length > 1 ? `${name} (${i === 0 ? 'L' : 'R'})` : name, b.target);
      masterPages.push({ id: m.id, spreadId: ms.attrs.Self, index: i, master: m });
    });
  }

  // spreads
  const pages: Page[] = [];
  let pageW = 0, pageH = 0, margins = { top: 0, right: 0, bottom: 0, left: 0 }, columns = 1, gutter = 12;
  for (const src of refs('idPkg:Spread')) {
    const x = await read(src);
    const sp = x && findAll(x, 'Spread')[0];
    if (!sp) continue;
    const boxes = convertSpread(sp, ctx);
    for (const [i, b] of boxes.entries()) {
      if (!pageW) {
        pageW = b.bounds.w;
        pageH = b.bounds.h;
        const mp = child(b.el, 'MarginPreference');
        if (mp) {
          margins = { top: Number(mp.attrs.Top ?? 0) * PX_PER_PT, bottom: Number(mp.attrs.Bottom ?? 0) * PX_PER_PT, left: Number(mp.attrs.Left ?? 0) * PX_PER_PT, right: Number(mp.attrs.Right ?? 0) * PX_PER_PT };
          columns = Number(mp.attrs.ColumnCount ?? 1);
          gutter = Number(mp.attrs.ColumnGutter ?? 12) * PX_PER_PT;
        }
      } else if (Math.abs(b.bounds.w - pageW) > 1 || Math.abs(b.bounds.h - pageH) > 1) warnings.push('Pages of different sizes were imported at the size of the first page');
      const applied = b.el.attrs.AppliedMaster;
      const candidates = masterPages.filter((m) => m.spreadId === applied);
      // facing masters have a left and a right page: match by position in the spread
      const master = candidates.length > 1 ? candidates[boxes.length > 1 ? Math.min(i, candidates.length - 1) : candidates.length - 1] : candidates[0];
      pages.push({ id: newId('pg'), name: b.el.attrs.Name ? `Page ${b.el.attrs.Name}` : `Page ${pages.length + 1}`, masterId: master?.id ?? null, nodes: b.target });
    }
  }
  if (!pages.length) throw new Error('The IDML file has no pages');

  const facing = docPref?.attrs.FacingPages === 'true';
  const doc = createDocument({
    title, studio: 'layout', pages: 1,
    settings: { width: Math.round(pageW * 100) / 100, height: Math.round(pageH * 100) / 100, unit: 'mm', dpi: 300, margins, columns, columnGutter: gutter, facingPages: facing, background: '#ffffff' },
  });
  const out = ctx.out;
  out.doc = { ...doc, pages, masters: masterPages.map((m) => m.master), assets: out.doc.assets, swatches: colours.swatches.length ? colours.swatches : doc.swatches };

  // stories & threading
  const stories: Record<Id, Story> = {};
  for (const src of refs('idPkg:Story')) {
    const x = await read(src);
    const st = x && findAll(x, 'Story')[0];
    if (!st) continue;
    const frames = [...ctx.frames.entries()].filter(([, f]) => f.story === st.attrs.Self);
    if (!frames.length) continue;
    const parsed = parseStory(x!, styles, colours);
    if (parsed.mixed) warnings.push('Stories with several paragraph/character styles use their first style throughout');
    const story = createStory(parsed.text, {});
    story.style = parsed.style;
    // order frames: start from the one with no previous frame (in this story), follow NextTextFrame
    const byId = new Map(frames);
    let startId = frames.find(([, f]) => f.prev === 'n' || !byId.has(f.prev))?.[0] ?? frames[0][0];
    const chain: Id[] = [];
    const seen = new Set<string>();
    while (startId && byId.has(startId) && !seen.has(startId)) {
      seen.add(startId);
      chain.push(byId.get(startId)!.node.id);
      startId = byId.get(startId)!.next;
    }
    for (const [fid, f] of frames) if (!seen.has(fid)) chain.push(f.node.id);
    story.chain = chain;
    stories[story.id] = story;
    for (const [, f] of frames) f.node.storyId = story.id;
  }
  // frames whose story file was missing get an empty story so they stay valid
  for (const [, f] of ctx.frames) {
    if (f.node.storyId) continue;
    const s = createStory('');
    s.chain = [f.node.id];
    stories[s.id] = s;
    f.node.storyId = s.id;
  }
  out.doc.stories = stories;

  // images
  let missingLinks = 0;
  for (const im of ctx.images) {
    let data: Uint8Array | null = null;
    const contents = prop(im.el, 'Contents');
    if (contents) data = base64ToBytes(contents);
    else {
      const link = child(im.el, 'Link');
      const uri = link?.attrs.LinkResourceURI;
      if (uri && resolveLink) data = await resolveLink(uri).catch(() => null);
    }
    const size = data ? imageSize(data) : null;
    if (!data || !size) { missingLinks++; continue; }
    const id = newId('a');
    out.encoded.set(id, { bytes: data, mime: size.mime });
    out.doc.assets[id] = { id, name: im.node.name, mime: size.mime, width: size.width, height: size.height };
    im.node.assetId = id;
    // place the image where InDesign had it: image inner (pt at its ppi) -> frame inner -> frame-local px
    const ppi = nums(prop(im.el, 'ActualPpi') ?? im.el.attrs.ActualPpi);
    const ptW = ppi[0] ? (size.width * 72) / ppi[0] : size.width * 0.75;
    const imgT = cat(cat(matrixOf(im.el.attrs.ItemTransform), im.frameInner), [PX_PER_PT, 0, 0, PX_PER_PT, 0, 0]);
    const [ax, ay] = ap(imgT, 0, 0);
    const [bx] = ap(imgT, ptW, 0);
    const wPx = Math.abs(bx - ax);
    if (wPx > 0 && im.el.attrs.ItemTransform) {
      const scale = wPx / size.width;
      const hPx = size.height * scale;
      im.node.fit = 'none';
      im.node.contentScale = scale;
      im.node.contentX = Math.min(ax, bx) + wPx / 2;
      im.node.contentY = ay + hPx / 2;
    }
  }
  if (missingLinks) warnings.push(`${missingLinks} linked image${missingLinks > 1 ? 's were' : ' was'} not found next to the file — the picture frames were kept empty`);
  out.warnings = summariseWarnings(warnings);
  return out;
}
