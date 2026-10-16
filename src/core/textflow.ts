import type { Id, Story, TabStop, TextStyle, TextStyleSheet } from './types';
import { FIELD_PAGE, fieldText, isField, styledParagraphs, type FieldContext, type StyledParagraph } from './typography';
import { hyphenPoints } from './hyphenation';

/** Default tab stops past the last set one: every ½ inch (48 px at 96 px/in), as in InDesign / Word. */
export const DEFAULT_TAB_INTERVAL = 48;

/** Measures the advance width of a run of text in the given style. */
export type MeasureFn = (text: string, style: TextStyle) => number;

export interface FlowFrame {
  id: Id;
  w: number;
  h: number;
  padding: number;
  columns: number;
  columnGap: number;
  /** text-wrap exclusions in frame-local coordinates (origin = the frame's top-left corner) */
  exclusions?: Exclusion[];
  /** page y of the frame's top edge (for the baseline grid); absent = 0 */
  pageTop?: number;
  /** values for page-number / section fields shown in this frame */
  fields?: FieldContext | null;
  /** vertical alignment of the text inside the frame (single column) */
  vAlign?: 'top' | 'middle' | 'bottom';
}

/** An area text must avoid: a polygon (box = its 4 corners) plus an offset; `jump` clears the full width. */
export interface Exclusion {
  kind: 'box' | 'contour' | 'jump';
  pts: { x: number; y: number }[];
  offset: number;
}

/** One stretch of a line in a single style. */
export interface LineRun {
  /** text as drawn (fields replaced by their value) */
  text: string;
  /** x relative to the frame's top-left corner */
  x: number;
  width: number;
  style: TextStyle;
  start: number;
  end: number;
  /** extra px per space (justified lines) */
  wordSpacing: number;
  /** baseline offset for this run (baseline shift / super / subscript), positive = up */
  rise: number;
  /** a tab: `width` is the space to the tab stop, `text` its leader (may be '') */
  tab?: boolean;
  /** the hyphen added at a hyphenated line end (not in the story: start === end) */
  hyphen?: boolean;
}

export interface LaidOutLine {
  text: string;
  /** position relative to the frame's top-left corner (top of the line box) */
  x: number;
  y: number;
  width: number;
  /** extra spacing per space for justified lines */
  wordSpacing: number;
  start: number;
  end: number;
  /** baseline relative to the frame's top-left corner */
  baseline?: number;
  /** line height (leading) */
  height?: number;
  /** styled runs */
  runs?: LineRun[];
  /** paragraph index in the story */
  para?: number;
  /** the line ends its paragraph */
  paragraphEnd?: boolean;
}

export interface FrameLayout {
  lines: LaidOutLine[];
  start: number;
  end: number;
}

export interface FlowResult {
  frames: Record<Id, FrameLayout>;
  overflow: boolean;
  /** index in the story where the overflowing text begins */
  overflowAt: number;
}

export interface BaselineGridSpec {
  start: number;
  increment: number;
}

interface RawLine {
  start: number;
  end: number; // exclusive, excludes trailing whitespace/newline
  next: number; // where the following line starts
  width: number;
  paragraphEnd: boolean;
}

export function lineHeightPx(style: TextStyle): number {
  return style.fontSize * style.lineHeight;
}

function withTracking(measure: MeasureFn, style: TextStyle): (s: string) => number {
  const extra = (style.letterSpacing / 1000) * style.fontSize;
  return (s: string) => measure(s, style) + (extra ? extra * s.length : 0);
}

/** Break the next line starting at `pos` to fit `maxWidth`. */
export function nextLine(text: string, pos: number, maxWidth: number, style: TextStyle, measure: MeasureFn): RawLine {
  const m = withTracking(measure, style);
  let paraEnd = text.indexOf('\n', pos);
  if (paraEnd < 0) paraEnd = text.length;
  const segment = text.slice(pos, paraEnd);
  if (m(segment.trimEnd()) <= maxWidth) {
    const trimmed = segment.trimEnd();
    return {
      start: pos,
      end: pos + trimmed.length,
      next: paraEnd < text.length ? paraEnd + 1 : paraEnd,
      width: m(trimmed),
      paragraphEnd: true,
    };
  }
  // greedy word wrap
  const re = /\S+\s*/g;
  re.lastIndex = 0;
  let fitEnd = 0; // length within segment that fits (excluding trailing spaces)
  let fitNext = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment))) {
    const wordEnd = match.index + match[0].trimEnd().length;
    const w = m(segment.slice(0, wordEnd));
    if (w > maxWidth) break;
    fitEnd = wordEnd;
    fitNext = match.index + match[0].length;
  }
  if (fitEnd === 0) {
    // leading whitespace or a single word longer than the line: break by characters
    let lead = 0;
    while (lead < segment.length && /\s/.test(segment[lead])) lead++;
    let n = lead + 1;
    while (n < segment.length && m(segment.slice(lead, n + 1)) <= maxWidth) n++;
    return { start: pos + lead, end: pos + n, next: pos + n, width: m(segment.slice(lead, n)), paragraphEnd: false };
  }
  return {
    start: pos,
    end: pos + fitEnd,
    next: pos + fitNext,
    width: m(segment.slice(0, fitEnd)),
    paragraphEnd: false,
  };
}

/** Flow a single-style story through an ordered chain of frames (and their columns). */
export function flowStory(text: string, style: TextStyle, frames: FlowFrame[], measure: MeasureFn, opts: FlowOptions = {}): FlowResult {
  const story: Story = { id: '_', text, style, chain: [] };
  return flowRichStory(story, { paragraph: [], character: [], cell: [] }, frames, measure, opts);
}

export interface FlowOptions {
  grid?: BaselineGridSpec | null;
}

/** Leading for a paragraph style at a given font size. */
export function leadingFor(p: TextStyle, fontSize: number): number {
  if (p.leading && p.leading > 0) return p.leading;
  return fontSize * p.lineHeight;
}

/** Ascent used to place the baseline inside a line box (matches svg.baselineOffset for one style). */
function baselineInLine(lh: number, fs: number): number {
  return (lh - fs) / 2 + fs * 0.8;
}

/** Effective size and rise for superscript / subscript / baseline shift. */
export function runMetrics(s: TextStyle): { size: number; rise: number } {
  let size = s.fontSize;
  let rise = s.baselineShift ?? 0;
  if (s.position === 'superscript') {
    size = s.fontSize * 0.6;
    rise += s.fontSize * 0.33;
  } else if (s.position === 'subscript') {
    size = s.fontSize * 0.6;
    rise -= s.fontSize * 0.12;
  }
  return { size, rise };
}

/** Style as drawn: superscript / subscript resolve to a smaller size. */
export function drawnStyle(s: TextStyle): TextStyle {
  if (!s.position || s.position === 'normal') return s;
  const { size } = runMetrics(s);
  return { ...s, fontSize: size, position: 'normal', baselineShift: 0 };
}

interface Token {
  start: number;
  end: number;
  text: string;
  style: TextStyle;
  space: boolean;
  width: number;
  /** tab (width set when the line is broken) or the added hyphen of a hyphenated line */
  kind?: 'tab' | 'hyphen';
  /** tab leader */
  leader?: string;
}

export function tokenWidth(measure: MeasureFn, t: string, s: TextStyle): number {
  const d = drawnStyle(s);
  return measure(t, d) + ((d.letterSpacing || 0) / 1000) * d.fontSize * t.length;
}

const isSpace = (ch: string) => ch === ' ';

/** Tokens for a paragraph from `pos`: split at run boundaries, whitespace and fields. */
function tokenize(text: string, para: StyledParagraph, pos: number, measure: MeasureFn, fields: FieldContext | null | undefined): Token[] {
  const out: Token[] = [];
  for (const r of para.runs) {
    if (r.end <= pos) continue;
    let i = Math.max(pos, r.start);
    while (i < r.end) {
      const ch = text[i];
      if (isField(ch)) {
        const t = fieldText(ch, fields);
        out.push({ start: i, end: i + 1, text: t, style: r.style, space: false, width: tokenWidth(measure, t, r.style) });
        i++;
        continue;
      }
      if (ch === '\t') {
        out.push({ start: i, end: i + 1, text: '\t', style: r.style, space: false, width: 0, kind: 'tab' });
        i++;
        continue;
      }
      const sp = isSpace(ch);
      let j = i + 1;
      while (j < r.end && !isField(text[j]) && text[j] !== '\t' && isSpace(text[j]) === sp) j++;
      const t = text.slice(i, j);
      out.push({ start: i, end: j, text: t, style: r.style, space: sp, width: tokenWidth(measure, t, r.style) });
      i = j;
    }
  }
  return out;
}

interface BrokenLine {
  tokens: Token[];
  start: number;
  /** exclusive, trailing spaces excluded */
  end: number;
  next: number;
  width: number;
  paragraphEnd: boolean;
}

/**
 * Greedy line break over styled tokens from token `from`. Long words that fit
 * no line are broken by characters. Spaces at a soft line start are swallowed.
 */
/** What breaking a line needs beyond the tokens: the paragraph style (tabs, hyphenation) and where the segment starts in its column. */
interface BreakCtx {
  style: TextStyle;
  /** x of the line segment's left edge from the column's left edge (tab stops are column-relative) */
  origin: number;
}

/** Width of tab token `i` that starts at column x `curX`: to the next stop, aligned as the stop says. */
function tabWidth(tokens: Token[], i: number, curX: number, ctx: BreakCtx, measure: MeasureFn): number {
  const stops = [...(ctx.style.tabStops ?? [])].sort((a, b) => a.pos - b.pos);
  let stop: TabStop | undefined = stops.find((st) => st.pos > curX + 0.01);
  if (!stop) {
    const base = stops.length ? stops[stops.length - 1].pos : 0;
    const n = Math.floor((curX - base) / DEFAULT_TAB_INTERVAL + 1e-6) + 1;
    stop = { pos: base + Math.max(1, n) * DEFAULT_TAB_INTERVAL, align: 'left' };
  }
  tokens[i].leader = stop.leader || undefined;
  if (stop.align === 'left') return stop.pos - curX;
  // right / centre / decimal: the text up to the next tab is placed against the stop
  let g = 0;
  let dec: number | null = null;
  for (let k = i + 1; k < tokens.length && tokens[k].kind !== 'tab'; k++) {
    const t = tokens[k];
    if (stop.align === 'decimal' && dec === null && !t.space) {
      const d = t.text.indexOf('.');
      if (d >= 0) dec = g + tokenWidth(measure, t.text.slice(0, d), t.style);
    }
    g += t.width;
  }
  const anchor = stop.align === 'center' ? g / 2 : stop.align === 'decimal' ? dec ?? g : g;
  return Math.max(0, stop.pos - curX - anchor);
}

const isWordToken = (text: string, t: Token) => !t.space && !t.kind && !isField(text[t.start]);

/**
 * Hyphenate the word that token `i` belongs to so that its first part (plus a
 * hyphen) ends the line. `w` is the line width before token `i`. Returns null
 * when the paragraph is not hyphenated or no break point fits.
 */
function tryHyphenate(text: string, tokens: Token[], first: number, i: number, w: number, maxWidth: number, ctx: BreakCtx, measure: MeasureFn): { line: BrokenLine; tokNext: number } | null {
  if (!ctx.style.hyphenate || !isWordToken(text, tokens[i])) return null;
  let j = i;
  while (j > first && isWordToken(text, tokens[j - 1]) && tokens[j - 1].end === tokens[j].start) j--;
  let e = i;
  while (e + 1 < tokens.length && isWordToken(text, tokens[e + 1]) && tokens[e + 1].start === tokens[e].end) e++;
  const w0 = tokens[j].start;
  const pts = hyphenPoints(text.slice(w0, tokens[e].end), ctx.style.language ?? 'en-GB');
  if (!pts.length) return null;
  let base = w;
  for (let k = j; k < i; k++) base -= tokens[k].width;
  for (let q = pts.length - 1; q >= 0; q--) {
    const abs = w0 + pts[q];
    let k = j;
    let acc = 0;
    while (k < e && tokens[k].end < abs) {
      acc += tokens[k].width;
      k++;
    }
    const tk = tokens[k];
    const off = abs - tk.start;
    if (off <= 0) continue;
    const pieceW = off >= tk.text.length ? tk.width : tokenWidth(measure, tk.text.slice(0, off), tk.style);
    const hyW = tokenWidth(measure, '-', tk.style);
    const total = base + acc + pieceW + hyW;
    if (total > maxWidth + 0.01) continue;
    let piece = tk;
    if (off < tk.text.length) {
      piece = { ...tk, end: abs, text: tk.text.slice(0, off), width: pieceW };
      const rest: Token = { ...tk, start: abs, text: tk.text.slice(off), width: tokenWidth(measure, tk.text.slice(off), tk.style) };
      tokens.splice(k, 1, piece, rest);
    }
    const hy: Token = { start: abs, end: abs, text: '-', style: tk.style, space: false, width: hyW, kind: 'hyphen' };
    const toks = [...tokens.slice(first, k), piece, hy];
    return { line: { tokens: toks, start: tokens[first].start, end: abs, next: abs, width: total, paragraphEnd: false }, tokNext: k + 1 };
  }
  return null;
}

function breakTokens(text: string, tokens: Token[], from: number, pos: number, paraEnd: number, maxWidth: number, measure: MeasureFn, ctx: BreakCtx): { line: BrokenLine; tokNext: number } {
  let i = from;
  if (pos > 0 && text[pos - 1] !== '\n') while (i < tokens.length && tokens[i].space) i++;
  const first = i;
  const fits = (w: number) => w <= maxWidth + 0.01;
  const nextAfterPara = paraEnd < text.length ? paraEnd + 1 : paraEnd;
  let w = 0;
  let breakAt = -1; // token index where the next line starts (after a space run)
  let widthAtBreak = 0;
  let endAtBreak = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'tab') {
      // a line may break before a tab; the tab then starts the next line
      if (i > first) {
        widthAtBreak = w;
        endAtBreak = tokens[i - 1].end;
        breakAt = i;
      }
      t.width = tabWidth(tokens, i, ctx.origin + w, ctx, measure);
      if (!fits(w + t.width)) {
        if (breakAt > first) {
          const toks = trimSpaces(tokens.slice(first, breakAt));
          return { line: { tokens: toks, start: tokens[first].start, end: endAtBreak, next: tokens[breakAt]?.start ?? nextAfterPara, width: widthAtBreak, paragraphEnd: false }, tokNext: breakAt };
        }
        t.width = Math.max(0, maxWidth - w); // a stop past the frame edge: the tab runs to the edge
      }
      w += t.width;
      continue;
    }
    if (t.space) {
      if (i > first && breakAt !== i) {
        widthAtBreak = w;
        endAtBreak = tokens[i - 1].end;
      }
      breakAt = i + 1;
      w += t.width;
      continue;
    }
    if (!fits(w + t.width)) {
      const hy = tryHyphenate(text, tokens, first, i, w, maxWidth, ctx, measure);
      if (hy) return hy;
      if (breakAt > first) {
        const toks = trimSpaces(tokens.slice(first, breakAt));
        return { line: { tokens: toks, start: tokens[first].start, end: endAtBreak, next: tokens[breakAt]?.start ?? nextAfterPara, width: widthAtBreak, paragraphEnd: false }, tokNext: breakAt };
      }
      break; // a word longer than the line: break it by characters
    }
    w += t.width;
  }
  if (i >= tokens.length) {
    const toks = trimSpaces(tokens.slice(first));
    const width = toks.reduce((a, t) => a + t.width, 0);
    const start = first < tokens.length ? tokens[first].start : pos;
    return { line: { tokens: toks, start, end: toks.length ? toks[toks.length - 1].end : start, next: nextAfterPara, width, paragraphEnd: true }, tokNext: tokens.length };
  }
  // character break of the word made of tokens first..i
  const toks: Token[] = [];
  let acc = 0;
  for (let k = first; k <= i; k++) {
    const t = tokens[k];
    if (k < i && fits(acc + t.width)) {
      toks.push(t);
      acc += t.width;
      continue;
    }
    let n = 0;
    while (n < t.text.length && fits(acc + tokenWidth(measure, t.text.slice(0, n + 1), t.style))) n++;
    if (n === 0 && toks.length) {
      const end = toks[toks.length - 1].end;
      return { line: { tokens: toks, start: toks[0].start, end, next: end, width: acc, paragraphEnd: false }, tokNext: k };
    }
    n = Math.max(1, n);
    if (isField(text[t.start]) || n >= t.end - t.start) {
      toks.push(t);
      acc += t.width;
      return { line: { tokens: toks, start: toks[0].start, end: t.end, next: t.end, width: acc, paragraphEnd: false }, tokNext: k + 1 };
    }
    const piece: Token = { ...t, end: t.start + n, text: t.text.slice(0, n), width: tokenWidth(measure, t.text.slice(0, n), t.style) };
    const rest: Token = { ...t, start: t.start + n, text: t.text.slice(n), width: tokenWidth(measure, t.text.slice(n), t.style) };
    tokens.splice(k, 1, piece, rest);
    toks.push(piece);
    acc += piece.width;
    return { line: { tokens: toks, start: toks[0].start, end: piece.end, next: piece.end, width: acc, paragraphEnd: false }, tokNext: k + 1 };
  }
  const end = toks.length ? toks[toks.length - 1].end : pos;
  return { line: { tokens: toks, start: toks.length ? toks[0].start : pos, end, next: end, width: acc, paragraphEnd: false }, tokNext: i };
}

function trimSpaces(toks: Token[]): Token[] {
  let e = toks.length;
  while (e > 0 && toks[e - 1].space) e--;
  return e === toks.length ? toks : toks.slice(0, e);
}

/** Horizontal intervals blocked by exclusions inside the band [y0, y1]. */
export function blockedIntervals(ex: Exclusion[], y0: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (const e of ex) {
    const o = e.offset;
    const a = y0 - o;
    const b = y1 + o;
    let minX = Infinity;
    let maxX = -Infinity;
    const pts = e.pts;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if (p.y > a && p.y < b) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
      }
      for (const yy of [a, b]) {
        if ((p.y - yy) * (q.y - yy) < 0) {
          const x = p.x + ((yy - p.y) / (q.y - p.y)) * (q.x - p.x);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (!isFinite(minX)) continue;
    out.push(e.kind === 'jump' ? [-Infinity, Infinity] : [minX - o, maxX + o]);
  }
  return out;
}

/** Free segments of [x0, x1] after removing blocked intervals; segments narrower than minW are dropped. */
export function freeSegments(x0: number, x1: number, blocked: [number, number][], minW: number): [number, number][] {
  let segs: [number, number][] = [[x0, x1]];
  for (const [a, b] of blocked) {
    const next: [number, number][] = [];
    for (const [s, e] of segs) {
      if (b <= s || a >= e) next.push([s, e]);
      else {
        if (a > s) next.push([s, a]);
        if (b < e) next.push([b, e]);
      }
    }
    segs = next;
  }
  return segs.filter(([s, e]) => e - s >= minW);
}

/**
 * Flow a formatted story (paragraph + character styles) through its frames:
 * columns, paragraph spacing and indents, mixed sizes per line, alignment and
 * justification, baseline-grid alignment, text wrap around exclusions and
 * page-number fields. Line `y` is the top of the line box; `baseline` is where
 * glyphs sit.
 */
export function flowRichStory(story: Story, sheet: TextStyleSheet, frames: FlowFrame[], measure: MeasureFn, opts: FlowOptions = {}): FlowResult {
  const text = story.text;
  const paras = styledParagraphs(story, sheet);
  const result: Record<Id, FrameLayout> = {};
  let pi = 0;
  let pos = 0;
  let tokens: Token[] | null = null;
  let tokIdx = 0;
  let tokensFields: FieldContext | null | undefined;
  const grid = opts.grid && opts.grid.increment > 0 ? opts.grid : null;
  const done = () => pos >= text.length || pi >= paras.length;

  for (const f of frames) {
    const layout: FrameLayout = { lines: [], start: pos, end: pos };
    const cols = Math.max(1, Math.round(f.columns));
    const innerW = Math.max(1, f.w - 2 * f.padding);
    const colW = Math.max(1, (innerW - (cols - 1) * f.columnGap) / cols);
    const bottom = f.h - f.padding;
    const ex = f.exclusions ?? [];
    if (tokens && tokensFields !== f.fields) tokens = null; // field values differ per frame
    for (let c = 0; c < cols && !done(); c++) {
      const colX = f.padding + c * (colW + f.columnGap);
      let y = f.padding;
      let colTop = true;
      let guard = 0;
      const rows: ColumnRow[] = [];
      while (!done() && guard++ < 200000) {
        const para = paras[pi];
        const ps = para.style;
        if (!tokens) {
          tokens = tokenize(text, para, pos, measure, f.fields);
          tokIdx = 0;
          tokensFields = f.fields;
        }
        const startOfPara = pos === para.start;
        const before = startOfPara && !colTop ? ps.spaceBefore ?? 0 : 0;
        const lineTop = y + before;
        const fsEst = Math.max(ps.fontSize, tokens[tokIdx] ? runMetrics(tokens[tokIdx].style).size : 0);
        const lhEst = leadingFor(ps, fsEst);
        if (lineTop + lhEst > bottom + 0.001) break; // column full
        const indentL = (ps.leftIndent ?? 0) + (startOfPara ? ps.firstIndent ?? 0 : 0);
        const x0 = colX + Math.max(0, indentL);
        const x1 = colX + colW - (ps.rightIndent ?? 0);
        const segs = ex.length
          ? freeSegments(x0, x1, blockedIntervals(ex, lineTop, lineTop + lhEst), Math.max(ps.fontSize * 1.5, 8))
          : [[x0, x1] as [number, number]];
        if (!segs.length) {
          // nothing fits beside an obstacle at this height: move down
          y = lineTop + Math.max(1, lhEst / 4);
          colTop = false;
          continue;
        }
        const savedPos = pos;
        const savedTok = tokIdx;
        const savedTokens = tokens.slice();
        const built: { line: BrokenLine; seg: [number, number] }[] = [];
        let paraEnded = false;
        for (const seg of segs) {
          if (paraEnded) break;
          const r = breakTokens(text, tokens, tokIdx, pos, para.end, Math.max(1, seg[1] - seg[0]), measure, { style: ps, origin: seg[0] - colX });
          tokIdx = r.tokNext;
          built.push({ line: r.line, seg });
          pos = r.line.next;
          if (r.line.paragraphEnd) paraEnded = true;
        }
        // real line metrics: the largest run sets the leading (auto leading)
        let fs = 0;
        for (const b of built) for (const t of b.line.tokens) fs = Math.max(fs, runMetrics(t.style).size);
        if (!fs) fs = ps.fontSize;
        const lh = leadingFor(ps, fs);
        let baseline = lineTop + baselineInLine(lh, fs);
        if (grid && ps.alignToGrid) {
          const pageY = (f.pageTop ?? 0) + baseline;
          const k = Math.max(0, Math.ceil((pageY - grid.start - 1e-6) / grid.increment));
          baseline = grid.start + k * grid.increment - (f.pageTop ?? 0);
        }
        const descent = lh - baselineInLine(lh, fs);
        if (baseline + descent > bottom + 0.001) {
          // taller than estimated (or pushed by the grid): this line goes to the next column
          pos = savedPos;
          tokIdx = savedTok;
          tokens = savedTokens;
          break;
        }
        rows.push({ lineIdx: layout.lines.length, pi, pos: savedPos, tokIdx: savedTok, tokens: savedTokens, startOfPara, endsPara: paraEnded });
        for (const { line, seg } of built) layout.lines.push(placeLine(text, line, seg, ps, lineTop, baseline, lh, pi, measure));
        y = baseline + descent;
        colTop = false;
        if (paraEnded) {
          y += ps.spaceAfter ?? 0;
          pi++;
          tokens = null;
          if (pi < paras.length) pos = paras[pi].start;
        }
      }
      if (!done() && rows.length) {
        // the column is full: keep options and widow / orphan control may end it earlier
        const live: ColumnRow = { lineIdx: layout.lines.length, pi, pos, tokIdx, tokens: tokens ? tokens.slice() : null, startOfPara: !!paras[pi] && pos === paras[pi].start, endsPara: false };
        const cut = keepCut(rows, paras, (k) => (k < rows.length ? rows[k] : live), (st, P, limit) => remainingLines(text, paras[P], st, colW, limit, measure, f.fields));
        if (cut < rows.length) {
          const st = rows[cut];
          layout.lines.length = st.lineIdx;
          pi = st.pi;
          pos = st.pos;
          tokIdx = st.tokIdx;
          tokens = st.tokens ? st.tokens.slice() : null;
          tokensFields = f.fields;
        }
      }
    }
    layout.end = pos;
    if (f.vAlign && f.vAlign !== 'top' && layout.lines.length && cols === 1) {
      const last = layout.lines[layout.lines.length - 1];
      const used = last.y + (last.height ?? 0) - f.padding;
      const free = f.h - 2 * f.padding - used;
      const dy = f.vAlign === 'middle' ? free / 2 : free;
      if (dy > 0) for (const l of layout.lines) {
        l.y += dy;
        l.baseline = (l.baseline ?? 0) + dy;
      }
    }
    result[f.id] = layout;
  }
  return { frames: result, overflow: pos < text.length, overflowAt: pos };
}

/** One row of lines in a column (several lines when text wraps around an obstacle) and the flow state before it. */
interface ColumnRow {
  lineIdx: number;
  pi: number;
  pos: number;
  tokIdx: number;
  tokens: Token[] | null;
  startOfPara: boolean;
  endsPara: boolean;
}

/** Lines paragraph `para` still needs from state `st` in a column `colW` wide (stops counting at `limit`). */
function remainingLines(text: string, para: StyledParagraph, st: ColumnRow, colW: number, limit: number, measure: MeasureFn, fields: FieldContext | null | undefined): number {
  const ps = para.style;
  const toks = st.tokens && st.pi === para.index ? st.tokens.slice() : tokenize(text, para, st.pos, measure, fields);
  let ti = st.tokens && st.pi === para.index ? st.tokIdx : 0;
  let p = st.pos;
  let n = 0;
  while (n < limit) {
    const indent = (ps.leftIndent ?? 0) + (p === para.start ? ps.firstIndent ?? 0 : 0);
    const r = breakTokens(text, toks, ti, p, para.end, Math.max(1, colW - Math.max(0, indent) - (ps.rightIndent ?? 0)), measure, { style: ps, origin: Math.max(0, indent) });
    n++;
    if (r.line.paragraphEnd || r.line.next <= p || r.line.next >= para.end) return n;
    ti = r.tokNext;
    p = r.line.next;
  }
  return n;
}

/**
 * Where a full column should end so keep options hold (InDesign's Keep
 * Options): keep with next, keep lines together, and orphans / widows (the
 * fewest lines of a broken paragraph at the foot of this column and at the
 * top of the next). Returns a row index; rows from there move on. When no cut
 * can satisfy the rules (a paragraph taller than the column), the column is
 * left as it is.
 */
function keepCut(rows: ColumnRow[], paras: StyledParagraph[], stateAt: (k: number) => ColumnRow, remaining: (st: ColumnRow, P: number, limit: number) => number): number {
  const orig = rows.length;
  let cut = orig;
  for (let guard = 0; cut > 0 && guard < 64; guard++) {
    const last = rows[cut - 1];
    const P = last.pi;
    const ps = paras[P].style;
    if (last.endsPara) {
      // the column breaks between paragraphs
      if (ps.keepWithNext && P + 1 < paras.length) {
        cut--;
        continue;
      }
      break;
    }
    let first = cut - 1;
    while (first > 0 && rows[first - 1].pi === P) first--;
    const k = cut - first;
    const startedHere = rows[first].startOfPara;
    const orphans = ps.orphans ?? 0;
    const widows = ps.widows ?? 0;
    if (startedHere && first > 0 && (ps.keepTogether || (orphans > 1 && k < orphans))) {
      cut = first;
      continue;
    }
    if (widows > 1) {
      const r = remaining(stateAt(cut), P, widows);
      if (r < widows) {
        const move = widows - r;
        if (k - move >= (startedHere ? Math.max(1, orphans) : 1)) {
          cut -= move;
          break;
        }
        if (startedHere && first > 0) {
          cut = first;
          continue;
        }
      }
    }
    break;
  }
  return cut <= 0 ? orig : cut;
}

function placeLine(text: string, line: BrokenLine, seg: [number, number], ps: TextStyle, top: number, baseline: number, lh: number, pi: number, measure: MeasureFn): LaidOutLine {
  const segW = seg[1] - seg[0];
  let x = seg[0];
  let wordSpacing = 0;
  if (ps.align === 'center') x = seg[0] + (segW - line.width) / 2;
  else if (ps.align === 'right') x = seg[1] - line.width;
  else if (ps.align === 'justify' && !line.paragraphEnd) {
    const spaces = line.tokens.reduce((a, t) => a + (t.space ? t.text.length : 0), 0);
    if (spaces > 0) wordSpacing = (segW - line.width) / spaces;
  }
  const runs: LineRun[] = [];
  let cx = x;
  for (const t of line.tokens) {
    const w = t.width + (t.space ? wordSpacing * t.text.length : 0);
    if (t.kind) {
      // tabs (with their leader) and the added hyphen are runs of their own
      let shown = t.kind === 'hyphen' ? '-' : '';
      if (t.kind === 'tab' && t.leader && w > 0) {
        const lw = tokenWidth(measure, t.leader, t.style);
        if (lw > 0) shown = t.leader.repeat(Math.floor(w / lw)).trimEnd();
      }
      runs.push({ text: shown, x: cx, width: w, style: t.style, start: t.start, end: t.end, wordSpacing: 0, rise: runMetrics(t.style).rise, ...(t.kind === 'tab' ? { tab: true } : { hyphen: true }) });
      cx += w;
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && !last.tab && !last.hyphen && last.style === t.style && last.end === t.start && !isField(text[t.start]) && !isField(text[last.end - 1])) {
      last.text += t.text;
      last.end = t.end;
      last.width += w;
    } else {
      runs.push({ text: t.text, x: cx, width: w, style: t.style, start: t.start, end: t.end, wordSpacing, rise: runMetrics(t.style).rise });
    }
    cx += w;
  }
  return {
    text: runs.map((r) => r.text).join(''),
    x,
    y: top,
    width: line.width,
    wordSpacing,
    start: line.start,
    end: line.end,
    baseline,
    height: lh,
    runs,
    para: pi,
    paragraphEnd: line.paragraphEnd,
  };
}

/** Caret x (frame-local) for a story index on a laid-out line. */
export function caretX(line: LaidOutLine, index: number, measure: MeasureFn): number {
  const runs = line.runs ?? [];
  if (!runs.length) return line.x;
  for (const r of runs) {
    if (index <= r.start) return r.x;
    if (index <= r.end) {
      if (r.tab || r.hyphen || r.end - r.start !== r.text.length) return index >= r.end ? r.x + r.width : r.x; // field, tab or hyphen
      const n = index - r.start;
      const sub = r.text.slice(0, n);
      const spaces = (sub.match(/ /g) ?? []).length;
      return r.x + tokenWidth(measure, sub, r.style) + spaces * r.wordSpacing;
    }
  }
  const last = runs[runs.length - 1];
  return last.x + last.width;
}

/** Story index nearest to frame-local x on a line. */
export function indexAtX(line: LaidOutLine, x: number, measure: MeasureFn): number {
  const runs = line.runs ?? [];
  if (!runs.length) return line.start;
  if (x <= runs[0].x) return runs[0].start;
  for (const r of runs) {
    if (x > r.x + r.width) continue;
    if (r.tab || r.hyphen || r.end - r.start !== r.text.length) return x - r.x < r.width / 2 ? r.start : r.end;
    let prev = r.x;
    for (let n = 1; n <= r.text.length; n++) {
      const cx = caretX(line, r.start + n, measure);
      if (x < (prev + cx) / 2) return r.start + n - 1;
      prev = cx;
    }
    return r.end;
  }
  return line.end;
}

/** The FIELD_PAGE marker, re-exported for callers that build stories. */
export const PAGE_NUMBER_FIELD = FIELD_PAGE;

/** Rough monospace measurer (used in tests and as a fallback without a canvas). */
export function monoMeasure(charWidthEm = 0.5): MeasureFn {
  return (s, style) => s.length * style.fontSize * charWidthEm;
}
