import type { Id, TextStyle } from './types';

/** Measures the advance width of a run of text in the given style. */
export type MeasureFn = (text: string, style: TextStyle) => number;

export interface FlowFrame {
  id: Id;
  w: number;
  h: number;
  padding: number;
  columns: number;
  columnGap: number;
}

export interface LaidOutLine {
  text: string;
  /** position relative to the frame's top-left corner (baseline is y + ascent) */
  x: number;
  y: number;
  width: number;
  /** extra spacing per space for justified lines */
  wordSpacing: number;
  start: number;
  end: number;
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

/** Flow a story through an ordered chain of frames (and their columns). */
export function flowStory(text: string, style: TextStyle, frames: FlowFrame[], measure: MeasureFn): FlowResult {
  const lh = lineHeightPx(style);
  const result: Record<Id, FrameLayout> = {};
  let pos = 0;
  for (const f of frames) {
    const layout: FrameLayout = { lines: [], start: pos, end: pos };
    const cols = Math.max(1, Math.round(f.columns));
    const innerW = Math.max(1, f.w - 2 * f.padding);
    const colW = Math.max(1, (innerW - (cols - 1) * f.columnGap) / cols);
    const innerH = f.h - 2 * f.padding;
    const linesPerCol = Math.max(0, Math.floor((innerH + 0.001) / lh));
    for (let c = 0; c < cols && pos < text.length; c++) {
      const colX = f.padding + c * (colW + f.columnGap);
      for (let li = 0; li < linesPerCol && pos < text.length; li++) {
        const raw = nextLine(text, pos, colW, style, measure);
        const lineText = text.slice(raw.start, raw.end);
        let x = colX;
        let wordSpacing = 0;
        if (style.align === 'center') x = colX + (colW - raw.width) / 2;
        else if (style.align === 'right') x = colX + colW - raw.width;
        else if (style.align === 'justify' && !raw.paragraphEnd) {
          const spaces = (lineText.match(/ /g) ?? []).length;
          if (spaces > 0) wordSpacing = (colW - raw.width) / spaces;
        }
        layout.lines.push({
          text: lineText,
          x,
          y: f.padding + li * lh,
          width: raw.width,
          wordSpacing,
          start: raw.start,
          end: raw.end,
        });
        pos = raw.next;
        if (raw.next <= raw.start && raw.end <= raw.start) pos = raw.start + 1; // safety
      }
    }
    // swallow a trailing newline that ended the frame exactly
    layout.end = pos;
    result[f.id] = layout;
  }
  return { frames: result, overflow: pos < text.length, overflowAt: pos };
}

/** Rough monospace measurer (used in tests and as a fallback without a canvas). */
export function monoMeasure(charWidthEm = 0.5): MeasureFn {
  return (s, style) => s.length * style.fontSize * charWidthEm;
}
