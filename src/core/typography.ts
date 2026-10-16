/**
 * Pro typography model (Layout studio): named paragraph / character styles with
 * based-on inheritance, per-character formatting spans, per-paragraph
 * formatting, and keeping all of that attached to the right text as the story
 * is edited. Pure and immutable; the flow engine (textflow.ts) consumes the
 * resolved runs.
 *
 * Resolution order for one character (later wins):
 *   story.style (the story's base) → paragraph style chain → paragraph overrides
 *   → character style chain → character overrides.
 * Editing a named style therefore updates every paragraph / run that uses it.
 */
import { newId } from './ids';
import type {
  CellProps, CellStyleDef, CharSpan, CharacterStyleDef, Id, ParaAttrs, ParagraphStyleDef, QuvreloDocument, Story,
  TextStyle, TextStyleSheet,
} from './types';

/** Keys that only make sense per paragraph (ignored in character styles / spans). */
export const PARAGRAPH_KEYS = [
  'align', 'lineHeight', 'leading', 'spaceBefore', 'spaceAfter', 'firstIndent', 'leftIndent', 'rightIndent', 'alignToGrid',
  'hyphenate', 'language', 'tabStops', 'keepWithNext', 'keepTogether', 'orphans', 'widows',
] as const satisfies readonly (keyof TextStyle)[];

/** Character attributes. */
export const CHARACTER_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'italic', 'underline', 'strike', 'letterSpacing', 'fill', 'kerning', 'caps',
  'ligatures', 'discretionaryLigatures', 'figures', 'figureSpacing', 'baselineShift', 'position',
] as const satisfies readonly (keyof TextStyle)[];

type ParaKey = (typeof PARAGRAPH_KEYS)[number];
const PARA_SET = new Set<string>(PARAGRAPH_KEYS);
const CHAR_SET = new Set<string>(CHARACTER_KEYS);

export function pickChar(p: Partial<TextStyle> | undefined): Partial<TextStyle> {
  const out: Partial<TextStyle> = {};
  if (!p) return out;
  for (const k of Object.keys(p) as (keyof TextStyle)[]) if (CHAR_SET.has(k) && p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  return out;
}
export function pickPara(p: Partial<TextStyle> | undefined): Partial<TextStyle> {
  const out: Partial<TextStyle> = {};
  if (!p) return out;
  for (const k of Object.keys(p) as (keyof TextStyle)[]) if (PARA_SET.has(k) && p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  return out;
}
export function isParaKey(k: string): k is ParaKey {
  return PARA_SET.has(k);
}

export const PARAGRAPH_BREAK = '\n';

// ---------------------------------------------------------------------------
// Fields (page number, page count, section name). One private-use character
// each, so they occupy exactly one position in the story and survive editing.

export const FIELD_PAGE = '\uE000';
export const FIELD_PAGE_COUNT = '\uE001';
export const FIELD_SECTION = '\uE002';
export const FIELDS: Record<string, { label: string }> = {
  [FIELD_PAGE]: { label: 'Page number' },
  [FIELD_PAGE_COUNT]: { label: 'Page count' },
  [FIELD_SECTION]: { label: 'Section name' },
};
export function isField(ch: string): boolean {
  return ch === FIELD_PAGE || ch === FIELD_PAGE_COUNT || ch === FIELD_SECTION;
}
export interface FieldContext {
  page: string;
  pageCount: string;
  section: string;
}
/** Text shown for a field character (master pages and the pasteboard show '#'). */
export function fieldText(ch: string, ctx: FieldContext | null | undefined): string {
  if (!ctx) return ch === FIELD_SECTION ? 'Section' : '#';
  if (ch === FIELD_PAGE) return ctx.page;
  if (ch === FIELD_PAGE_COUNT) return ctx.pageCount;
  return ctx.section;
}

// ---------------------------------------------------------------------------
// Style sheet

export function emptySheet(): TextStyleSheet {
  return { paragraph: [], character: [], cell: [] };
}
export function sheetOf(doc: Pick<QuvreloDocument, 'textStyles'>): TextStyleSheet {
  return doc.textStyles ?? EMPTY_SHEET;
}
const EMPTY_SHEET: TextStyleSheet = Object.freeze({ paragraph: [], character: [], cell: [] }) as TextStyleSheet;

function chainProps<T extends { id: Id; basedOn: Id | null; props: Partial<TextStyle> }>(list: T[], id: Id | null | undefined): Partial<TextStyle> {
  if (!id) return {};
  const byId = new Map(list.map((s) => [s.id, s]));
  const chain: T[] = [];
  const seen = new Set<Id>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.basedOn ? byId.get(cur.basedOn) : undefined;
  }
  return Object.assign({}, ...chain.map((s) => s.props));
}

/** All attributes a paragraph style defines, including those inherited through basedOn. */
export function resolveParagraphStyle(sheet: TextStyleSheet, id: Id | null | undefined): Partial<TextStyle> {
  return chainProps(sheet.paragraph, id);
}
/** Character attributes a character style defines (inherited through basedOn). */
export function resolveCharacterStyle(sheet: TextStyleSheet, id: Id | null | undefined): Partial<TextStyle> {
  return pickChar(chainProps(sheet.character, id));
}

/** Would making `id` based on `basedOn` create a cycle? */
export function wouldCycle(list: { id: Id; basedOn: Id | null }[], id: Id, basedOn: Id | null): boolean {
  const byId = new Map(list.map((s) => [s.id, s]));
  let cur = basedOn;
  const seen = new Set<Id>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.basedOn ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Paragraph helpers

/** [start, end) of each paragraph (end excludes the break). */
export function paragraphRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let s = 0;
  for (;;) {
    const i = text.indexOf(PARAGRAPH_BREAK, s);
    if (i < 0) {
      out.push({ start: s, end: text.length });
      return out;
    }
    out.push({ start: s, end: i });
    s = i + 1;
  }
}

export function paragraphIndexAt(text: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(pos, text.length); i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Fully resolved style of paragraph `pi` (character attributes are the paragraph's defaults). */
export function paragraphStyle(story: Story, sheet: TextStyleSheet, pi: number): TextStyle {
  const a = story.paras?.[pi] ?? null;
  return { ...story.style, ...resolveParagraphStyle(sheet, a?.styleId), ...(a?.props ?? {}) };
}

// ---------------------------------------------------------------------------
// Resolved runs

export interface StyledRun {
  start: number;
  end: number;
  style: TextStyle;
}
export interface StyledParagraph {
  index: number;
  start: number;
  end: number;
  style: TextStyle;
  runs: StyledRun[];
}

const styleKeyCache = new WeakMap<object, string>();
/**
 * JSON with object keys sorted at every level. (An array replacer for
 * JSON.stringify would also filter nested keys, so fills, tab stops and other
 * nested values would all look alike.)
 */
export function stableKey(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableKey).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`).join(',')}}`;
}
/** Stable identity for equal resolved styles so measurement caches hit. */
const interned = new Map<string, TextStyle>();
export function internStyle(s: TextStyle): TextStyle {
  let key = styleKeyCache.get(s);
  if (!key) {
    key = stableKey(s);
    styleKeyCache.set(s, key);
  }
  const hit = interned.get(key);
  if (hit) return hit;
  if (interned.size > 5000) interned.clear();
  interned.set(key, s);
  styleKeyCache.set(s, key);
  return s;
}

/**
 * Split a story into paragraphs and character runs with fully resolved
 * styles. Runs never cross a paragraph break and adjacent runs with equal
 * styles are merged.
 */
export function styledParagraphs(story: Story, sheet: TextStyleSheet): StyledParagraph[] {
  const spans = story.spans ?? [];
  const out: StyledParagraph[] = [];
  let si = 0;
  paragraphRanges(story.text).forEach((r, pi) => {
    const pstyle = paragraphStyle(story, sheet, pi);
    const runs: StyledRun[] = [];
    let pos = r.start;
    const push = (start: number, end: number, span: CharSpan | null) => {
      if (end <= start) return;
      const style = internStyle(span ? { ...pstyle, ...resolveCharacterStyle(sheet, span.styleId), ...pickChar(span.props) } : internStyle(pstyle));
      const last = runs[runs.length - 1];
      if (last && last.style === style && last.end === start) last.end = end;
      else runs.push({ start, end, style });
    };
    while (si < spans.length && spans[si].end <= r.start) si++;
    let k = si;
    while (pos < r.end) {
      const sp = spans[k];
      if (!sp || sp.start >= r.end) {
        push(pos, r.end, null);
        pos = r.end;
        break;
      }
      if (sp.start > pos) {
        push(pos, sp.start, null);
        pos = sp.start;
      }
      const e = Math.min(sp.end, r.end);
      push(Math.max(pos, sp.start), e, sp);
      pos = e;
      if (sp.end <= r.end) k++;
    }
    out.push({ index: pi, start: r.start, end: r.end, style: internStyle(pstyle), runs });
  });
  return out;
}

/** Resolved style of the character at `pos` (or the one before it at a paragraph end). */
export function styleAt(story: Story, sheet: TextStyleSheet, pos: number): TextStyle {
  const pi = paragraphIndexAt(story.text, pos);
  const pstyle = paragraphStyle(story, sheet, pi);
  const sp = (story.spans ?? []).find((s) => pos >= s.start && pos < s.end) ?? (story.spans ?? []).find((s) => pos > s.start && pos === s.end);
  return sp ? { ...pstyle, ...resolveCharacterStyle(sheet, sp.styleId), ...pickChar(sp.props) } : pstyle;
}

/** Common value of a key over a range, or undefined when mixed. */
export function rangeValue<K extends keyof TextStyle>(story: Story, sheet: TextStyleSheet, start: number, end: number, key: K): TextStyle[K] | undefined {
  if (end <= start) return styleAt(story, sheet, start)[key];
  let v: TextStyle[K] | undefined;
  let first = true;
  for (const p of styledParagraphs(story, sheet)) {
    for (const r of p.runs) {
      if (r.end <= start || r.start >= end) continue;
      const x = r.style[key];
      if (first) {
        v = x;
        first = false;
      } else if (JSON.stringify(x) !== JSON.stringify(v)) return undefined;
    }
  }
  return first ? styleAt(story, sheet, start)[key] : v;
}

/** Whether `key` differs across the characters of [start, end) (an unset key everywhere is not mixed). */
export function rangeMixed(story: Story, sheet: TextStyleSheet, start: number, end: number, key: keyof TextStyle): boolean {
  if (end <= start) return false;
  let seen: string | null = null;
  for (const p of styledParagraphs(story, sheet)) {
    for (const r of p.runs) {
      if (r.end <= start || r.start >= end) continue;
      const k = stableKey(r.style[key] ?? null);
      if (seen === null) seen = k;
      else if (k !== seen) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Span arithmetic

function sameSpanFormat(a: CharSpan, b: CharSpan): boolean {
  return (a.styleId ?? null) === (b.styleId ?? null) && JSON.stringify(a.props ?? {}) === JSON.stringify(b.props ?? {});
}
function isPlain(s: CharSpan): boolean {
  return !s.styleId && (!s.props || Object.keys(s.props).length === 0);
}

/** Sort, drop empty / plain spans and merge touching spans with equal formatting. */
export function normaliseSpans(spans: CharSpan[]): CharSpan[] {
  const sorted = spans.filter((s) => s.end > s.start && !isPlain(s)).sort((a, b) => a.start - b.start);
  const out: CharSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.end === s.start && sameSpanFormat(last, s)) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

/**
 * Reformat [start, end): each piece of existing formatting (or plain text) in
 * the range is passed to `fn`, which returns its new formatting.
 */
export function mapSpanRange(spans: CharSpan[], start: number, end: number, fn: (cur: CharSpan | null) => Omit<CharSpan, 'start' | 'end'>): CharSpan[] {
  if (end <= start) return spans;
  const out: CharSpan[] = [];
  let pos = start;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    if (s.end <= start || s.start >= end) {
      out.push(s);
      continue;
    }
    if (s.start < start) out.push({ ...s, end: start });
    if (s.end > end) out.push({ ...s, start: end });
    const a = Math.max(s.start, start);
    const b = Math.min(s.end, end);
    if (a > pos) out.push({ start: pos, end: a, ...fn(null) });
    out.push({ start: a, end: b, ...fn(s) });
    pos = b;
  }
  if (pos < end) out.push({ start: pos, end, ...fn(null) });
  return normaliseSpans(out);
}

/** Overlay character attributes on a range (per-character styling). */
export function applyCharProps(story: Story, start: number, end: number, props: Partial<TextStyle>): Story {
  const p = pickChar(props);
  const spans = mapSpanRange(story.spans ?? [], start, end, (cur) => ({ styleId: cur?.styleId ?? null, props: { ...(cur?.props ?? {}), ...p } }));
  return { ...story, spans };
}

/** Apply a named character style to a range; local overrides there are cleared unless `keepOverrides`. */
export function applyCharStyle(story: Story, start: number, end: number, styleId: Id | null, keepOverrides = false): Story {
  const spans = mapSpanRange(story.spans ?? [], start, end, (cur) => ({ styleId, props: keepOverrides ? cur?.props : undefined }));
  return { ...story, spans };
}

/** Remove character formatting in a range. */
export function clearCharFormatting(story: Story, start: number, end: number): Story {
  return { ...story, spans: mapSpanRange(story.spans ?? [], start, end, () => ({})) };
}

/** Paragraph indices touched by [start, end]. */
export function paragraphsInRange(text: string, start: number, end: number): number[] {
  const a = paragraphIndexAt(text, start);
  const b = paragraphIndexAt(text, Math.max(start, end));
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function setParas(story: Story, idx: number[], fn: (cur: ParaAttrs | null) => ParaAttrs | null): Story {
  const count = paragraphRanges(story.text).length;
  const paras = Array.from({ length: count }, (_, i) => story.paras?.[i] ?? null);
  for (const i of idx) if (i < count) paras[i] = fn(paras[i]);
  return { ...story, paras: trimParas(paras) };
}
function trimParas(p: (ParaAttrs | null)[]): (ParaAttrs | null)[] {
  const out = p.map((a) => (a && (a.styleId || (a.props && Object.keys(a.props).length)) ? a : null));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/** Apply a paragraph style to the paragraphs touched by a range. Clears paragraph overrides unless `keepOverrides`. */
export function applyParagraphStyle(story: Story, start: number, end: number, styleId: Id | null, keepOverrides = false): Story {
  return setParas(story, paragraphsInRange(story.text, start, end), (cur) => ({ styleId, props: keepOverrides ? cur?.props : undefined }));
}

/** Overlay paragraph attributes (alignment, spacing, indents, leading…) on the paragraphs touched by a range. */
export function applyParaProps(story: Story, start: number, end: number, props: Partial<TextStyle>): Story {
  const p = pickPara(props);
  return setParas(story, paragraphsInRange(story.text, start, end), (cur) => ({ styleId: cur?.styleId ?? null, props: { ...(cur?.props ?? {}), ...p } }));
}

/**
 * Route a style patch to the right place for a text range: paragraph keys to
 * the paragraphs it touches, character keys to the characters (whole story
 * when the range is collapsed and `wholeIfCollapsed`).
 */
export function applyTextPatch(story: Story, start: number, end: number, patch: Partial<TextStyle>): Story {
  let s = story;
  const para = pickPara(patch);
  const chr = pickChar(patch);
  if (Object.keys(para).length) s = applyParaProps(s, start, end, para);
  if (Object.keys(chr).length && end > start) s = applyCharProps(s, start, end, chr);
  return s;
}

// ---------------------------------------------------------------------------
// Keeping formatting attached while the text changes

/**
 * Replace a story's text, moving character spans and paragraph attributes with
 * the text they belong to. The edit is found as the single changed region
 * between the common prefix and suffix. Text typed at the end of a formatted
 * run continues that run (as in InDesign); new paragraphs take the format of
 * the paragraph they were split from (or its `nextStyle`).
 */
export function replaceStoryText(story: Story, text: string, sheet: TextStyleSheet = EMPTY_SHEET): Story {
  const old = story.text;
  if (old === text) return story;
  if (!story.spans?.length && !story.paras?.length) return { ...story, text };
  let p = 0;
  const max = Math.min(old.length, text.length);
  while (p < max && old.charCodeAt(p) === text.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && old.charCodeAt(old.length - 1 - s) === text.charCodeAt(text.length - 1 - s)) s++;
  const oldEnd = old.length - s;
  const newEnd = text.length - s;
  const delta = text.length - old.length;
  const insertion = oldEnd === p;
  // replaced text takes the format of the first replaced character; inserted
  // text takes the format of the character before it (InDesign behaviour)
  const mapStart = (x: number) => {
    if (x < p) return x;
    if (x === p) return insertion && p > 0 ? x + delta : x;
    return x >= oldEnd ? x + delta : newEnd;
  };
  const mapEnd = (x: number) => {
    if (x < p) return x;
    if (x === p) return insertion ? newEnd : p;
    return x >= oldEnd ? x + delta : newEnd;
  };
  let spans: CharSpan[] | undefined;
  if (story.spans?.length) {
    spans = normaliseSpans(story.spans.map((sp) => {
      const a = mapStart(sp.start);
      const b = mapEnd(sp.end);
      return { ...sp, start: a, end: Math.max(a, b) };
    }));
  }
  let paras = story.paras;
  if (paras?.length) {
    const pi = paragraphIndexAt(old, p);
    const removed = countBreaks(old, p, oldEnd);
    const added = countBreaks(text, p, newEnd);
    const total = paragraphRanges(old).length;
    const full = Array.from({ length: total }, (_, i) => paras![i] ?? null);
    const src = full[pi];
    const nextId = src?.styleId ? sheet.paragraph.find((x) => x.id === src.styleId)?.nextStyle : undefined;
    const fresh: ParaAttrs | null = nextId ? { styleId: nextId } : src ? { ...src } : null;
    full.splice(pi + 1, removed, ...Array.from({ length: added }, () => (fresh ? { ...fresh } : null)));
    paras = trimParas(full);
  }
  const out: Story = { ...story, text };
  if (spans) out.spans = spans;
  if (paras) out.paras = paras;
  return out;
}

function countBreaks(t: string, a: number, b: number): number {
  let n = 0;
  for (let i = a; i < b; i++) if (t.charCodeAt(i) === 10) n++;
  return n;
}

/** Copy of a story's formatting restricted to [start, end), shifted to 0 (for splitting stories). */
export function sliceStory(story: Story, start: number, end: number): Pick<Story, 'text' | 'spans' | 'paras'> {
  const text = story.text.slice(start, end);
  const spans = normaliseSpans((story.spans ?? []).filter((s) => s.end > start && s.start < end).map((s) => ({ ...s, start: Math.max(0, s.start - start), end: Math.min(end, s.end) - start })));
  const p0 = paragraphIndexAt(story.text, start);
  const n = paragraphRanges(text).length;
  const paras = trimParas(Array.from({ length: n }, (_, i) => story.paras?.[p0 + i] ?? null));
  return { text, spans, paras };
}

// ---------------------------------------------------------------------------
// Style sheet commands (document level)

function withSheet(doc: QuvreloDocument, fn: (s: TextStyleSheet) => TextStyleSheet): QuvreloDocument {
  return { ...doc, textStyles: fn(doc.textStyles ?? emptySheet()) };
}

export function addParagraphStyle(doc: QuvreloDocument, init: Partial<Omit<ParagraphStyleDef, 'id'>> = {}): { doc: QuvreloDocument; id: Id } {
  const id = newId('ps');
  const name = init.name ?? uniqueName((doc.textStyles?.paragraph ?? []).map((s) => s.name), 'Paragraph Style');
  const def: ParagraphStyleDef = { id, name, basedOn: init.basedOn ?? null, props: init.props ?? {}, nextStyle: init.nextStyle ?? null };
  return { doc: withSheet(doc, (s) => ({ ...s, paragraph: [...s.paragraph, def] })), id };
}
export function addCharacterStyle(doc: QuvreloDocument, init: Partial<Omit<CharacterStyleDef, 'id'>> = {}): { doc: QuvreloDocument; id: Id } {
  const id = newId('cs');
  const name = init.name ?? uniqueName((doc.textStyles?.character ?? []).map((s) => s.name), 'Character Style');
  const def: CharacterStyleDef = { id, name, basedOn: init.basedOn ?? null, props: pickChar(init.props) };
  return { doc: withSheet(doc, (s) => ({ ...s, character: [...s.character, def] })), id };
}
export function addCellStyle(doc: QuvreloDocument, init: Partial<Omit<CellStyleDef, 'id'>> = {}): { doc: QuvreloDocument; id: Id } {
  const id = newId('cl');
  const name = init.name ?? uniqueName((doc.textStyles?.cell ?? []).map((s) => s.name), 'Cell Style');
  const def: CellStyleDef = { id, name, props: init.props ?? {} };
  return { doc: withSheet(doc, (s) => ({ ...s, cell: [...(s.cell ?? []), def] })), id };
}

/** Patch a named style; every paragraph / run / cell using it updates on the next layout. */
export function updateTextStyle(
  doc: QuvreloDocument,
  kind: 'paragraph' | 'character' | 'cell',
  id: Id,
  patch: { name?: string; basedOn?: Id | null; props?: Partial<TextStyle> | Partial<CellProps>; replaceProps?: boolean; nextStyle?: Id | null },
): QuvreloDocument {
  return withSheet(doc, (s) => {
    if (kind === 'cell') {
      return { ...s, cell: (s.cell ?? []).map((c) => (c.id === id ? { ...c, name: patch.name ?? c.name, props: patch.replaceProps ? (patch.props as Partial<CellProps>) : { ...c.props, ...(patch.props as Partial<CellProps>) } } : c)) };
    }
    const list = kind === 'paragraph' ? s.paragraph : s.character;
    if (patch.basedOn !== undefined && patch.basedOn && wouldCycle(list, id, patch.basedOn)) throw new Error('A style can’t be based on itself');
    const mapped = list.map((st) => {
      if (st.id !== id) return st;
      let props = patch.props ? (patch.replaceProps ? (patch.props as Partial<TextStyle>) : { ...st.props, ...(patch.props as Partial<TextStyle>) }) : st.props;
      if (kind === 'character') props = pickChar(props);
      // drop keys explicitly set to undefined (reset to inherited)
      props = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<TextStyle>;
      const next = { ...st, name: patch.name ?? st.name, basedOn: patch.basedOn !== undefined ? patch.basedOn : st.basedOn, props };
      if (kind === 'paragraph' && patch.nextStyle !== undefined) (next as ParagraphStyleDef).nextStyle = patch.nextStyle;
      return next;
    });
    return kind === 'paragraph' ? { ...s, paragraph: mapped as ParagraphStyleDef[] } : { ...s, character: mapped as CharacterStyleDef[] };
  });
}

/**
 * Delete a named style. Text using it keeps its look: the style's resolved
 * attributes are folded into the local overrides (as InDesign's "preserve
 * formatting"). Styles based on it are re-based on its parent.
 */
export function deleteTextStyle(doc: QuvreloDocument, kind: 'paragraph' | 'character' | 'cell', id: Id): QuvreloDocument {
  const sheet = doc.textStyles ?? emptySheet();
  if (kind === 'cell') {
    const def = sheet.cell.find((c) => c.id === id);
    let out = withSheet(doc, (s) => ({ ...s, cell: s.cell.filter((c) => c.id !== id) }));
    if (def) out = mapTables(out, (cell) => (cell.styleId === id ? { ...cell, styleId: null, props: { ...def.props, ...(cell.props ?? {}) } } : cell));
    return out;
  }
  const list: { id: Id; basedOn: Id | null }[] = kind === 'paragraph' ? sheet.paragraph : sheet.character;
  const victim = list.find((s) => s.id === id);
  if (!victim) return doc;
  const resolved = kind === 'paragraph' ? resolveParagraphStyle(sheet, id) : resolveCharacterStyle(sheet, id);
  const parentResolved = kind === 'paragraph' ? resolveParagraphStyle(sheet, victim.basedOn) : resolveCharacterStyle(sheet, victim.basedOn);
  // what the victim adds over its parent
  const own: Partial<TextStyle> = {};
  for (const [k, v] of Object.entries(resolved)) if (JSON.stringify((parentResolved as Record<string, unknown>)[k]) !== JSON.stringify(v)) (own as Record<string, unknown>)[k] = v;
  const stories: Record<Id, Story> = {};
  for (const [sid, st] of Object.entries(doc.stories)) {
    let next = st;
    if (kind === 'paragraph' && st.paras?.some((a) => a?.styleId === id)) {
      next = { ...next, paras: st.paras.map((a) => (a?.styleId === id ? { styleId: victim.basedOn, props: { ...own, ...(a.props ?? {}) } } : a)) };
    }
    if (kind === 'character' && st.spans?.some((s) => s.styleId === id)) {
      next = { ...next, spans: st.spans.map((s) => (s.styleId === id ? { ...s, styleId: victim.basedOn, props: { ...own, ...(s.props ?? {}) } } : s)) };
    }
    stories[sid] = next;
  }
  let out: QuvreloDocument = { ...doc, stories };
  // character formatting inside table cells
  if (kind === 'character') out = mapTables(out, (cell) => (cell.spans?.some((s) => s.styleId === id) ? { ...cell, spans: cell.spans.map((s) => (s.styleId === id ? { ...s, styleId: victim.basedOn, props: { ...own, ...(s.props ?? {}) } } : s)) } : cell));
  out = withSheet(out, (s) =>
    kind === 'paragraph'
      ? { ...s, paragraph: s.paragraph.filter((x) => x.id !== id).map((x) => ({ ...x, basedOn: x.basedOn === id ? victim.basedOn : x.basedOn, nextStyle: x.nextStyle === id ? null : x.nextStyle })) }
      : { ...s, character: s.character.filter((x) => x.id !== id).map((x) => ({ ...x, basedOn: x.basedOn === id ? victim.basedOn : x.basedOn })) },
  );
  return out;
}

/** Map every cell of every table (used by cell-style deletion). */
function mapTables(doc: QuvreloDocument, fn: (c: import('./types').TableCell) => import('./types').TableCell): QuvreloDocument {
  const visit = (nodes: import('./types').SceneNode[]): import('./types').SceneNode[] =>
    nodes.map((n) => (n.type === 'table' ? { ...n, cells: n.cells.map((r) => r.map(fn)) } : n.type === 'group' ? { ...n, children: visit(n.children) } : n));
  return { ...doc, pages: doc.pages.map((p) => ({ ...p, nodes: visit(p.nodes) })), masters: doc.masters.map((m) => ({ ...m, nodes: visit(m.nodes) })) };
}

/** Count of paragraphs / runs / cells using a style (shown in the styles panel). */
export function styleUsage(doc: QuvreloDocument, kind: 'paragraph' | 'character' | 'cell', id: Id): number {
  let n = 0;
  if (kind === 'cell' || kind === 'character') {
    const visit = (nodes: import('./types').SceneNode[]) => {
      for (const x of nodes) {
        if (x.type === 'table') for (const r of x.cells) for (const c of r) {
          if (kind === 'cell' && c.styleId === id) n++;
          if (kind === 'character') n += (c.spans ?? []).filter((s) => s.styleId === id).length;
        }
        if (x.type === 'group') visit(x.children);
      }
    };
    doc.pages.forEach((p) => visit(p.nodes));
    doc.masters.forEach((p) => visit(p.nodes));
    if (kind === 'cell') return n;
  }
  for (const st of Object.values(doc.stories)) {
    if (kind === 'paragraph') n += (st.paras ?? []).filter((a) => a?.styleId === id).length;
    else n += (st.spans ?? []).filter((s) => s.styleId === id).length;
  }
  return n;
}

/** A paragraph style capturing the formatting at a position (Create style from selection). */
export function styleFromText(story: Story, sheet: TextStyleSheet, pos: number): Partial<TextStyle> {
  const s = styleAt(story, sheet, pos);
  const out: Partial<TextStyle> = {};
  for (const k of [...CHARACTER_KEYS, ...PARAGRAPH_KEYS]) if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

function uniqueName(existing: string[], base: string): string {
  let i = existing.length + 1;
  while (existing.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/** The starter styles a new layout document gets (Body, Heading 1/2, Caption; Emphasis, Strong). */
export function defaultLayoutStyles(): TextStyleSheet {
  const body: ParagraphStyleDef = { id: newId('ps'), name: 'Body', basedOn: null, props: { fontFamily: 'EB Garamond, Georgia, serif', fontSize: 14, lineHeight: 1.35, spaceAfter: 8, figures: 'oldstyle', widows: 2, orphans: 2 }, nextStyle: null };
  const h1: ParagraphStyleDef = { id: newId('ps'), name: 'Heading 1', basedOn: body.id, props: { fontFamily: 'Inter, sans-serif', fontSize: 28, fontWeight: 700, lineHeight: 1.15, spaceBefore: 12, spaceAfter: 10, figures: 'lining', letterSpacing: -10, keepWithNext: true }, nextStyle: body.id };
  const h2: ParagraphStyleDef = { id: newId('ps'), name: 'Heading 2', basedOn: h1.id, props: { fontSize: 20, spaceBefore: 10, spaceAfter: 6 }, nextStyle: body.id };
  const caption: ParagraphStyleDef = { id: newId('ps'), name: 'Caption', basedOn: body.id, props: { fontSize: 11, italic: true, spaceAfter: 4 }, nextStyle: null };
  const em: CharacterStyleDef = { id: newId('cs'), name: 'Emphasis', basedOn: null, props: { italic: true } };
  const strong: CharacterStyleDef = { id: newId('cs'), name: 'Strong', basedOn: null, props: { fontWeight: 700 } };
  const sc: CharacterStyleDef = { id: newId('cs'), name: 'Small caps', basedOn: null, props: { caps: 'all-small-caps', letterSpacing: 50 } };
  const header: CellStyleDef = { id: newId('cl'), name: 'Header cell', props: { fill: { type: 'solid', color: '#1b1d22' }, text: { fill: { type: 'solid', color: '#ffffff' }, fontWeight: 700 } } };
  return { paragraph: [body, h1, h2, caption], character: [em, strong, sc], cell: [header] };
}
