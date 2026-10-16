/**
 * IDML rich text: per-paragraph and per-character styles, the named style
 * sheet, and tables — mapped onto the shapes of the Layout text model.
 *
 * The Rich* types below are structural mirrors of the Layout text model
 * (src/core/types.ts: CharSpan, ParaAttrs, TextStyleSheet, ParagraphStyleDef,
 * CharacterStyleDef, CellStyleDef, TableCell, TableNode). The importer writes
 * spans / paras / textStyles into the document under those field names and the
 * Layout text engine draws them (MODEL_HAS_RICH_TEXT).
 *
 * Tables (MODEL_HAS_TABLES): parseRichStory records each table with where its
 * tab-separated fallback sits in the story text; tablesToNodes() takes that
 * fallback out of the story and returns Layout TableNodes to place over the
 * story's first frame (with a jump text wrap, so the text clears the table).
 */
import { defaultTextStyle, solid } from '../document';
import { newId } from '../ids';
import type { CharSpan, ParaAttrs, Paint, TableNode, TextAlign, TextStyle } from '../types';
import { makeTable } from '../tables';
import { child, elements, findAll, textOf, type XmlElement } from './xml';

export const MODEL_HAS_RICH_TEXT = true;
export const MODEL_HAS_TABLES = true;

const PX_PER_PT = 96 / 72;

/** Partial text attributes, including the Layout paragraph/character fields not yet on main's TextStyle. */
export type RichProps = Partial<TextStyle> & {
  leading?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  firstIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  strike?: boolean;
  position?: 'normal' | 'superscript' | 'subscript';
  baselineShift?: number;
  hyphenate?: boolean;
  keepWithNext?: boolean;
  keepTogether?: boolean;
  ligatures?: boolean;
};

export interface RichCharSpan { start: number; end: number; styleId?: string | null; props?: RichProps }
export interface RichParaAttrs { styleId?: string | null; props?: RichProps }
export interface RichParagraphStyle { id: string; name: string; basedOn: string | null; props: RichProps; nextStyle?: string | null }
export interface RichCharacterStyle { id: string; name: string; basedOn: string | null; props: RichProps }
export interface RichCellProps { fill: Paint; stroke: Paint; strokeWidth: number; padding: number; vAlign: 'top' | 'middle' | 'bottom'; text: RichProps }
export interface RichCellStyle { id: string; name: string; props: Partial<RichCellProps> }
export interface RichStyleSheet { paragraph: RichParagraphStyle[]; character: RichCharacterStyle[]; cell: RichCellStyle[] }
export interface RichCell { text: string; spans?: RichCharSpan[]; rowSpan?: number; colSpan?: number; styleId?: string | null; props?: Partial<RichCellProps> }
export interface RichTable {
  /** where the tab-separated fallback text of this table starts / ends in the story text */
  start: number;
  end: number;
  headerRows: number;
  colWidths: number[];
  rowHeights: number[];
  cells: RichCell[][];
}
export interface RichStory { spans: RichCharSpan[]; paras: (RichParaAttrs | null)[]; tables: RichTable[] }

type Attrs = Record<string, string>;

/** Read an IDML colour/tint reference as a paint (supplied by the importer's colour table). */
export type PaintOf = (ref: string | undefined, tint?: string) => Paint | null;

function prop(e: XmlElement, name: string): string | undefined {
  const p = child(e, 'Properties');
  const n = p && child(p, name);
  return n ? textOf(n).trim() : undefined;
}

/** An element's own style attributes plus the ones IDML keeps in <Properties>. */
export function ownAttrs(e: XmlElement): Attrs {
  const out: Attrs = { ...e.attrs };
  for (const k of ['AppliedFont', 'Leading', 'BasedOn', 'NextStyle']) {
    const v = prop(e, k);
    if (v !== undefined) out[k] = v;
  }
  delete out.Self;
  return out;
}

const ALIGN: Record<string, TextAlign> = {
  LeftAlign: 'left', CenterAlign: 'center', RightAlign: 'right', LeftJustified: 'justify', CenterJustified: 'justify',
  RightJustified: 'justify', FullyJustified: 'justify', ToBindingSide: 'left', AwayFromBindingSide: 'right',
};

function fontStyle(fs: string): { weight: number; italic: boolean } {
  const s = fs.toLowerCase();
  const weights: [RegExp, number][] = [[/thin|hairline/, 100], [/extra ?light|ultra ?light/, 200], [/light/, 300], [/medium/, 500], [/semi ?bold|demi/, 600], [/extra ?bold|ultra ?bold/, 800], [/black|heavy/, 900], [/bold/, 700]];
  return { weight: weights.find(([r]) => r.test(s))?.[1] ?? 400, italic: /italic|oblique/.test(s) };
}

const pt = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) * PX_PER_PT : undefined);

/** Only the attributes present become properties (a style or override sets what it names). */
export function propsFromAttrs(a: Attrs, paint: PaintOf): RichProps {
  const p: RichProps = {};
  const base = defaultTextStyle().fontFamily;
  if (a.AppliedFont) p.fontFamily = `${a.AppliedFont}, ${base}`;
  if (pt(a.PointSize) !== undefined) p.fontSize = pt(a.PointSize);
  if (a.FontStyle) { const f = fontStyle(a.FontStyle); p.fontWeight = f.weight; p.italic = f.italic; }
  if (a.Leading !== undefined) p.leading = a.Leading === 'Auto' ? 0 : pt(a.Leading) ?? 0;
  if (a.Tracking !== undefined) p.letterSpacing = Number(a.Tracking) || 0;
  if (a.Justification && ALIGN[a.Justification]) p.align = ALIGN[a.Justification];
  if (a.FillColor !== undefined) { const f = paint(a.FillColor, a.FillTint); if (f) p.fill = f; }
  if (a.Underline !== undefined) p.underline = a.Underline === 'true';
  if (a.StrikeThru !== undefined) p.strike = a.StrikeThru === 'true';
  if (a.Capitalization) p.caps = a.Capitalization === 'SmallCaps' ? 'small-caps' : a.Capitalization === 'CapToSmallCap' ? 'all-small-caps' : 'normal';
  if (a.Position) p.position = /Superscript/.test(a.Position) ? 'superscript' : /Subscript/.test(a.Position) ? 'subscript' : 'normal';
  if (a.BaselineShift !== undefined) p.baselineShift = pt(a.BaselineShift) ?? 0;
  if (a.SpaceBefore !== undefined) p.spaceBefore = pt(a.SpaceBefore) ?? 0;
  if (a.SpaceAfter !== undefined) p.spaceAfter = pt(a.SpaceAfter) ?? 0;
  if (a.FirstLineIndent !== undefined) p.firstIndent = pt(a.FirstLineIndent) ?? 0;
  if (a.LeftIndent !== undefined) p.leftIndent = pt(a.LeftIndent) ?? 0;
  if (a.RightIndent !== undefined) p.rightIndent = pt(a.RightIndent) ?? 0;
  if (a.Hyphenation !== undefined) p.hyphenate = a.Hyphenation === 'true';
  if (a.KeepWithNext !== undefined) p.keepWithNext = Number(a.KeepWithNext) > 0;
  if (a.KeepAllLinesTogether !== undefined) p.keepTogether = a.KeepAllLinesTogether === 'true';
  if (a.Ligatures !== undefined) p.ligatures = a.Ligatures !== 'false';
  return p;
}

/** InDesign's own defaults ([No paragraph style]): root styles are completed with these. */
function rootDefaults(paint: PaintOf): RichProps {
  return {
    fontFamily: `Minion Pro, ${defaultTextStyle().fontFamily}`, fontSize: 12 * PX_PER_PT, fontWeight: 400, italic: false,
    leading: 0, letterSpacing: 0, align: 'left', fill: paint('Color/Black') ?? solid('#231f20'), underline: false,
  };
}

const cleanName = (n: string | undefined, self: string) => (n ?? self).replace(/^\$ID\//, '').replace(/^(ParagraphStyle|CharacterStyle|CellStyle)\//, '');
const isNone = (ref: string | undefined) => !ref || /\[No (character|paragraph) style\]$/.test(ref) || ref === 'n';

export interface SheetIndex {
  sheet: RichStyleSheet;
  para: Map<string, string>; // IDML Self → sheet id
  char: Map<string, string>;
  cell: Map<string, string>;
}

/** Resources/Styles.xml → named paragraph, character and cell styles (BasedOn kept as a chain). */
export function buildStyleSheet(styles: XmlElement | null, paint: PaintOf): SheetIndex {
  const idx: SheetIndex = { sheet: { paragraph: [], character: [], cell: [] }, para: new Map(), char: new Map(), cell: new Map() };
  if (!styles) return idx;
  const ps = findAll(styles, 'ParagraphStyle');
  const cs = findAll(styles, 'CharacterStyle').filter((e) => !isNone(e.attrs.Self));
  for (const e of ps) idx.para.set(e.attrs.Self, newId('ps'));
  for (const e of cs) idx.char.set(e.attrs.Self, newId('cs'));
  for (const e of ps) {
    const a = ownAttrs(e);
    // [No paragraph style] is a real style in IDML (InDesign's defaults): chain to it when the file defines it
    const basedOn = a.BasedOn ? idx.para.get(a.BasedOn) ?? null : null;
    const props = propsFromAttrs(a, paint);
    idx.sheet.paragraph.push({
      id: idx.para.get(e.attrs.Self)!, name: cleanName(e.attrs.Name, e.attrs.Self), basedOn,
      props: basedOn ? props : { ...rootDefaults(paint), ...props },
      nextStyle: a.NextStyle ? idx.para.get(a.NextStyle) ?? null : null,
    });
  }
  for (const e of cs) {
    const a = ownAttrs(e);
    idx.sheet.character.push({ id: idx.char.get(e.attrs.Self)!, name: cleanName(e.attrs.Name, e.attrs.Self), basedOn: a.BasedOn && !isNone(a.BasedOn) ? idx.char.get(a.BasedOn) ?? null : null, props: propsFromAttrs(a, paint) });
  }
  for (const e of findAll(styles, 'CellStyle')) {
    if (/\[None\]$/.test(e.attrs.Self)) continue;
    const id = newId('cl');
    idx.cell.set(e.attrs.Self, id);
    idx.sheet.cell.push({ id, name: cleanName(e.attrs.Name, e.attrs.Self), props: cellProps(e.attrs, paint) });
  }
  return idx;
}

function cellProps(a: Attrs, paint: PaintOf): Partial<RichCellProps> {
  const p: Partial<RichCellProps> = {};
  if (a.FillColor) { const f = paint(a.FillColor, a.FillTint); if (f) p.fill = f; }
  const edgeColour = a.TopEdgeStrokeColor ?? a.LeftEdgeStrokeColor;
  if (edgeColour) { const s = paint(edgeColour, a.TopEdgeStrokeTint); if (s) p.stroke = s; }
  const w = pt(a.TopEdgeStrokeWeight ?? a.LeftEdgeStrokeWeight);
  if (w !== undefined) p.strokeWidth = w;
  const inset = pt(a.TopInset ?? a.LeftInset);
  if (inset !== undefined) p.padding = inset;
  if (a.VerticalJustification) p.vAlign = a.VerticalJustification === 'CenterAlign' ? 'middle' : a.VerticalJustification === 'BottomAlign' ? 'bottom' : 'top';
  return p;
}

const sameProps = (a: RichProps | undefined, b: RichProps | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export interface ParsedRichStory {
  text: string;
  rich: RichStory;
  /** attributes of the first visible run, resolved through the style chains (for main's one-style stories) */
  firstAttrs: Attrs | null;
  /** distinct resolved run signatures (more than one = mixed styling) */
  signatures: number;
  paragraphStyleNames: string[];
}

/** Resolves an IDML style reference through its BasedOn chain (importer's Styles). */
export interface StyleChains { paragraph(ref: string | undefined): Attrs; character(ref: string | undefined): Attrs }

/**
 * Story XML → text plus per-paragraph / per-character formatting. The text is
 * built exactly as InDesign stores it: Content, <Br/> = paragraph break,
 * <Tab/>, U+2028 forced line break (a new paragraph in Quvrelo), tables as one
 * tab-separated paragraph per row.
 */
export function parseRichStory(storyRoot: XmlElement, chains: StyleChains, idx: SheetIndex, paint: PaintOf): ParsedRichStory {
  const story = findAll(storyRoot, 'Story')[0] ?? storyRoot;
  let text = '';
  const spans: RichCharSpan[] = [];
  const paras: (RichParaAttrs | null)[] = [];
  const tables: RichTable[] = [];
  let first: Attrs | null = null;
  const signatures = new Set<string>();
  const paraNames = new Set<string>();
  let curPara: RichParaAttrs | null = null;
  let breakAfterTable = false;
  let nl = 0; // paragraph breaks so far = index of the current paragraph

  const atParaStart = () => text.length === 0 || text.endsWith('\n');
  const markPara = () => {
    if (!atParaStart()) return;
    paras[nl] = curPara && (curPara.styleId || Object.keys(curPara.props ?? {}).length) ? curPara : null;
  };
  const emit = (t: string, span: { styleId: string | null; props: RichProps } | null) => {
    if (breakAfterTable) { breakAfterTable = false; if (!t.startsWith('\n')) emit('\n', null); }
    for (const piece of t.split(/(\n)/)) {
      if (!piece) continue;
      if (piece !== '\n') markPara();
      const start = text.length;
      text += piece;
      if (piece === '\n') nl++;
      if (piece !== '\n' && span && (span.styleId || Object.keys(span.props).length)) {
        const last = spans[spans.length - 1];
        if (last && last.end === start && last.styleId === span.styleId && sameProps(last.props, span.props)) last.end = text.length;
        else spans.push({ start, end: text.length, ...(span.styleId ? { styleId: span.styleId } : {}), ...(Object.keys(span.props).length ? { props: span.props } : {}) });
      }
    }
  };

  const visitCsr = (csr: XmlElement, pAttrs: Attrs) => {
    const own = ownAttrs(csr);
    const charRef = own.AppliedCharacterStyle;
    delete own.AppliedCharacterStyle;
    const resolved = { ...pAttrs, ...chains.character(charRef), ...own };
    const span = { styleId: !isNone(charRef) ? idx.char.get(charRef!) ?? null : null, props: propsFromAttrs(own, paint) };
    for (const c of csr.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'Content') {
        const t = textOf(c).replace(/\u2028/g, '\n').replace(/\uFEFF/g, '');
        if (t) {
          if (!first) first = resolved;
          signatures.add(JSON.stringify([resolved.PointSize, resolved.FontStyle, resolved.AppliedFont, resolved.FillColor, resolved.Justification, resolved.Leading, resolved.Tracking]));
        }
        emit(t, span);
      } else if (c.name === 'Br') emit('\n', null);
      else if (c.name === 'Tab') emit('\t', span);
      else if (c.name === 'Table') table(c);
      else if (c.name === 'HyperlinkTextSource' || c.name === 'XMLElement' || c.name === 'Change') visitCsr({ ...c, attrs: csr.attrs }, pAttrs);
    }
  };
  const visitPsr = (psr: XmlElement) => {
    const ref = psr.attrs.AppliedParagraphStyle;
    paraNames.add(cleanName(ref ?? '', ''));
    const own = ownAttrs(psr);
    delete own.AppliedParagraphStyle;
    curPara = { ...(ref && idx.para.get(ref) ? { styleId: idx.para.get(ref)! } : {}), ...(Object.keys(propsFromAttrs(own, paint)).length ? { props: propsFromAttrs(own, paint) } : {}) };
    const pAttrs = { ...chains.paragraph(ref), ...own };
    for (const c of elements(psr)) {
      if (c.name === 'CharacterStyleRange') visitCsr(c, pAttrs);
      else if (c.name === 'Br') emit('\n', null);
      else if (c.name === 'Table') table(c);
      else if (c.name === 'XMLElement' || c.name === 'Change') visitPsr({ ...c, attrs: psr.attrs });
    }
  };

  const table = (t: XmlElement) => {
    const cols = elements(t, 'Column');
    const rows = elements(t, 'Row');
    const nCols = Number(t.attrs.ColumnCount ?? cols.length) || cols.length;
    const nRows = (Number(t.attrs.HeaderRowCount ?? 0) + Number(t.attrs.BodyRowCount ?? 0) + Number(t.attrs.FooterRowCount ?? 0)) || rows.length;
    if (!nCols || !nRows) return;
    const colWidths = Array.from({ length: nCols }, (_, i) => pt(cols.find((c) => c.attrs.Name === String(i))?.attrs.SingleColumnWidth) ?? 72 * PX_PER_PT);
    const rowHeights = Array.from({ length: nRows }, (_, i) => { const r = rows.find((x) => x.attrs.Name === String(i)); return pt(r?.attrs.SingleRowHeight ?? r?.attrs.MinimumHeight) ?? 18 * PX_PER_PT; });
    const cells: RichCell[][] = Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => ({ text: '' })));
    for (const c of elements(t, 'Cell')) {
      const [ci, ri] = (c.attrs.Name ?? '').split(':').map(Number);
      if (!(ri >= 0 && ri < nRows && ci >= 0 && ci < nCols)) continue;
      const inner = parseRichStory({ name: 'Story', attrs: {}, children: c.children }, chains, idx, paint);
      const cell: RichCell = { text: inner.text };
      if (inner.rich.spans.length) cell.spans = inner.rich.spans;
      const rs = Number(c.attrs.RowSpan ?? 1), cs = Number(c.attrs.ColumnSpan ?? 1);
      if (rs > 1) cell.rowSpan = rs;
      if (cs > 1) cell.colSpan = cs;
      if (c.attrs.AppliedCellStyle && idx.cell.get(c.attrs.AppliedCellStyle)) cell.styleId = idx.cell.get(c.attrs.AppliedCellStyle)!;
      const props = cellProps(c.attrs, paint);
      if (Object.keys(props).length) cell.props = props;
      cells[ri][ci] = cell;
    }
    // fallback on main: one tab-separated paragraph per row
    if (!atParaStart()) emit('\n', null);
    const start = text.length;
    cells.forEach((row, r) => {
      if (r) emit('\n', null);
      emit(row.map((c) => c.text.replace(/\n/g, ' ')).join('\t'), null);
    });
    tables.push({ start, end: text.length, headerRows: Number(t.attrs.HeaderRowCount ?? 0), colWidths, rowHeights, cells });
    breakAfterTable = true;
  };

  for (const c of elements(story)) {
    if (c.name === 'ParagraphStyleRange') visitPsr(c);
    else if (c.name === 'XMLElement') for (const p of findAll(c, 'ParagraphStyleRange')) visitPsr(p);
  }
  // InDesign ends a story with a paragraph mark; Quvrelo doesn't keep a trailing empty paragraph
  if (text.endsWith('\n')) text = text.slice(0, -1);
  const nParas = text.split('\n').length;
  paras.length = Math.min(paras.length, nParas);
  for (let i = 0; i < paras.length; i++) if (paras[i] === undefined) paras[i] = null;
  const clipped = spans.filter((s) => s.start < text.length).map((s) => ({ ...s, end: Math.min(s.end, text.length) }));
  return { text, rich: { spans: clipped, paras, tables }, firstAttrs: first, signatures: signatures.size, paragraphStyleNames: [...paraNames].filter(Boolean) };
}

/** A story's text and formatting with its tables taken out, plus the tables as Layout TableNodes. */
export interface StoryTables {
  text: string;
  spans: CharSpan[];
  paras: (ParaAttrs | null)[];
  /** each table and the number of story paragraphs before it (for placing it in the frame) */
  tables: { node: TableNode; parasBefore: number }[];
}

/**
 * Turn a story's tables into TableNodes and remove their tab-separated
 * fallback paragraphs (one per row) from the text, shifting the character
 * spans and paragraph attributes that follow. Node positions are left at 0,0
 * for the importer to place.
 */
export function tablesToNodes(text: string, rich: RichStory): StoryTables {
  let spans: CharSpan[] = rich.spans.map((s) => ({ ...s }));
  let paras: (ParaAttrs | null)[] = [...rich.paras];
  const out: { node: TableNode; parasBefore: number; start: number }[] = [];
  // last table first, so earlier offsets stay valid
  for (const t of [...rich.tables].sort((a, b) => b.start - a.start)) {
    const rows = t.cells.length;
    const cols = t.colWidths.length;
    if (!rows || !cols) continue;
    const w = t.colWidths.reduce((a, b) => a + b, 0);
    const h = t.rowHeights.reduce((a, b) => a + b, 0);
    const node = makeTable(rows, cols, {
      name: 'Table', w, h, colWidths: [...t.colWidths], rowHeights: [...t.rowHeights], headerRows: Math.min(t.headerRows, rows),
      cells: t.cells.map((row) => row.map((c) => ({
        text: c.text,
        ...(c.spans?.length ? { spans: c.spans as CharSpan[] } : {}),
        ...(c.rowSpan && c.rowSpan > 1 ? { rowSpan: c.rowSpan } : {}),
        ...(c.colSpan && c.colSpan > 1 ? { colSpan: c.colSpan } : {}),
        ...(c.styleId ? { styleId: c.styleId } : {}),
        ...(c.props && Object.keys(c.props).length ? { props: c.props as TableNode['cells'][number][number]['props'] } : {}),
      }))),
    });
    // the fallback is whole paragraphs: cut it with the paragraph break after it (or before it at the story's end)
    let cutStart = t.start;
    let cutEnd = t.end;
    if (cutEnd < text.length && text[cutEnd] === '\n') cutEnd++;
    else if (cutStart > 0 && text[cutStart - 1] === '\n') cutStart--;
    const len = cutEnd - cutStart;
    const parasBefore = text.slice(0, t.start).split('\n').length - 1;
    text = text.slice(0, cutStart) + text.slice(cutEnd);
    spans = spans
      .filter((s) => s.end <= cutStart || s.start >= cutEnd)
      .map((s) => (s.start >= cutEnd ? { ...s, start: s.start - len, end: s.end - len } : s));
    paras.splice(parasBefore, rows);
    out.push({ node, parasBefore, start: cutStart });
  }
  const nParas = text ? text.split('\n').length : 0;
  paras = paras.slice(0, nParas);
  return { text, spans, paras, tables: out.sort((a, b) => a.start - b.start).map(({ node, parasBefore }) => ({ node, parasBefore })) };
}
