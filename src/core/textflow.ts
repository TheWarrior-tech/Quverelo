import type { Id, Story, TextStyle, TextStyleSheet } from './types';
import { FIELD_PAGE, fieldText, isField, styledParagraphs, type FieldContext, type StyledParagraph } from './typography';

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
}

export function tokenWidth(measure: MeasureFn, t: string, s: TextStyle): number {
  const d = drawnStyle(s);
  return measure(t, d) + ((d.letterSpacing || 0) / 1000) * d.fontSize * t.length;
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t';

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
      const sp = isSpace(ch);
      let j = i + 1;
      while (j < r.end && !isField(text[j]) && isSpace(text[j]) === sp) j++;
      const t = text.slice(i, j).replace(/\t/g, '    ');
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
function breakTokens(text: string, tokens: Token[], from: number, pos: number, paraEnd: number, maxWidth: number, measure: MeasureFn): { line: BrokenLine; tokNext: number } {
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
          const r = breakTokens(text, tokens, tokIdx, pos, para.end, Math.max(1, seg[1] - seg[0]), measure);
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
        for (const { line, seg } of built) layout.lines.push(placeLine(text, line, seg, ps, lineTop, baseline, lh, pi));
        y = baseline + descent;
        colTop = false;
        if (paraEnded) {
          y += ps.spaceAfter ?? 0;
          pi++;
          tokens = null;
          if (pi < paras.length) pos = paras[pi].start;
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

function placeLine(text: string, line: BrokenLine, seg: [number, number], ps: TextStyle, top: number, baseline: number, lh: number, pi: number): LaidOutLine {
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
    const last = runs[runs.length - 1];
    if (last && last.style === t.style && last.end === t.start && !isField(text[t.start]) && !isField(text[last.end - 1])) {
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
      if (r.end - r.start !== r.text.length) return index >= r.end ? r.x + r.width : r.x; // field or tab
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
    if (r.end - r.start !== r.text.length) return x - r.x < r.width / 2 ? r.start : r.end;
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
