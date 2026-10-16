/**
 * Layout tables: a rows × columns grid node with merged cells, header rows and
 * named cell styles. Column widths and row heights are stored in px and are
 * scaled to the node's w / h when the table is resized as a whole.
 */
import { newId } from './ids';
import { defaultTextStyle, solid } from './document';
import { flowRichStory, type FlowResult, type MeasureFn } from './textflow';
import { applyCharProps, applyCharStyle, clearCharFormatting, normaliseSpans, replaceStoryText } from './typography';
import type { CellProps, CharSpan, Id, Paint, Story, TableCell, TableNode, TextStyle, TextStyleSheet } from './types';

export const DEFAULT_CELL: CellProps = {
  fill: { type: 'none' },
  stroke: solid('#33363d'),
  strokeWidth: 1,
  padding: 6,
  vAlign: 'top',
  text: {},
};

export const TABLE_TEXT_BASE: TextStyle = defaultTextStyle({ fontSize: 12, lineHeight: 1.25 });

export function makeTable(rows: number, cols: number, init: Partial<TableNode> = {}): TableNode {
  const r = Math.max(1, Math.min(200, Math.round(rows)));
  const c = Math.max(1, Math.min(50, Math.round(cols)));
  const w = init.w ?? 480;
  const h = init.h ?? r * 32;
  return {
    id: newId('n'), name: 'Table', visible: true, locked: false, opacity: 1, blend: 'normal',
    x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, flipX: false, flipY: false,
    w, h,
    colWidths: Array.from({ length: c }, () => w / c),
    rowHeights: Array.from({ length: r }, () => h / r),
    cells: Array.from({ length: r }, () => Array.from({ length: c }, () => ({ text: '' }))),
    headerRows: 0,
    ...init,
    type: 'table',
  };
}

export const rowCount = (t: TableNode) => t.rowHeights.length;
export const colCount = (t: TableNode) => t.colWidths.length;

/** Column widths / row heights scaled to the node's current size. */
export function scaledTracks(t: TableNode): { cols: number[]; rows: number[] } {
  const sw = t.colWidths.reduce((a, b) => a + b, 0) || 1;
  const sh = t.rowHeights.reduce((a, b) => a + b, 0) || 1;
  return { cols: t.colWidths.map((x) => (x * t.w) / sw), rows: t.rowHeights.map((y) => (y * t.h) / sh) };
}

/** Top-left cell of the merge covering (r, c) (itself when not covered). */
export function anchorOf(t: TableNode, r: number, c: number): { r: number; c: number } {
  for (let rr = 0; rr <= r; rr++) {
    for (let cc = 0; cc <= c; cc++) {
      const cell = t.cells[rr]?.[cc];
      if (!cell) continue;
      const rs = cell.rowSpan ?? 1;
      const cs = cell.colSpan ?? 1;
      if ((rs > 1 || cs > 1) && r < rr + rs && c < cc + cs) return { r: rr, c: cc };
    }
  }
  return { r, c };
}

export function isCovered(t: TableNode, r: number, c: number): boolean {
  const a = anchorOf(t, r, c);
  return a.r !== r || a.c !== c;
}

/** Cell rectangle in table-local coordinates (origin = top-left), merges included. */
export function cellRect(t: TableNode, r: number, c: number): { x: number; y: number; w: number; h: number } {
  const { cols, rows } = scaledTracks(t);
  const cell = t.cells[r][c];
  const rs = Math.min(cell.rowSpan ?? 1, rows.length - r);
  const cs = Math.min(cell.colSpan ?? 1, cols.length - c);
  const x = cols.slice(0, c).reduce((a, b) => a + b, 0);
  const y = rows.slice(0, r).reduce((a, b) => a + b, 0);
  return { x, y, w: cols.slice(c, c + cs).reduce((a, b) => a + b, 0), h: rows.slice(r, r + rs).reduce((a, b) => a + b, 0) };
}

/** Cell at a table-local point (top-left origin), resolved to its merge anchor. */
export function cellAt(t: TableNode, x: number, y: number): { r: number; c: number } | null {
  const { cols, rows } = scaledTracks(t);
  if (x < 0 || y < 0) return null;
  let c = 0;
  let acc = 0;
  while (c < cols.length && acc + cols[c] < x) acc += cols[c++];
  let r = 0;
  acc = 0;
  while (r < rows.length && acc + rows[r] < y) acc += rows[r++];
  if (r >= rows.length || c >= cols.length) return null;
  return anchorOf(t, r, c);
}

/** Resolved formatting of a cell: defaults → header defaults → named style → local props. */
export function resolveCell(t: TableNode, sheet: TextStyleSheet, r: number, c: number): CellProps {
  const cell = t.cells[r][c];
  const header: Partial<CellProps> = r < t.headerRows ? { fill: solid('#ecedef'), text: { fontWeight: 700 } } : {};
  const named = cell.styleId ? sheet.cell?.find((s) => s.id === cell.styleId)?.props ?? {} : {};
  const local = cell.props ?? {};
  return {
    ...DEFAULT_CELL,
    ...header,
    ...named,
    ...local,
    text: { ...DEFAULT_CELL.text, ...(header.text ?? {}), ...(named.text ?? {}), ...(local.text ?? {}) },
  };
}

export function cellTextStyle(p: CellProps): TextStyle {
  return { ...TABLE_TEXT_BASE, ...p.text };
}

/** Id used for a cell's text where a story id is expected (editor selection, styles). */
export function cellStoryId(tableId: Id, r: number, c: number): Id {
  return `cell:${tableId}:${r}:${c}`;
}

/** A cell's text as a story (base style = the resolved cell text style; per-character spans). */
export function cellStory(t: TableNode, sheet: TextStyleSheet, r: number, c: number): Story {
  const cell = t.cells[r][c];
  const story: Story = { id: cellStoryId(t.id, r, c), text: cell.text, style: cellTextStyle(resolveCell(t, sheet, r, c)), chain: [] };
  if (cell.spans?.length) story.spans = cell.spans;
  return story;
}

function withCellStory(t: TableNode, r: number, c: number, fn: (s: Story) => Story): TableNode {
  return mapCell(t, r, c, (cell) => {
    const st = fn({ id: '_', text: cell.text, style: TABLE_TEXT_BASE, chain: [], spans: cell.spans });
    const next: TableCell = { ...cell, text: st.text };
    const spans = st.spans?.length ? normaliseSpans(st.spans) : [];
    if (spans.length) next.spans = spans;
    else delete next.spans;
    return next;
  });
}

/** Per-character formatting inside a cell (bold a word, superscript, small caps…). */
export function applyCellCharProps(t: TableNode, r: number, c: number, start: number, end: number, props: Partial<TextStyle>): TableNode {
  return withCellStory(t, r, c, (s) => applyCharProps(s, start, end, props));
}

/** A character style on a range of a cell's text. */
export function applyCellCharStyle(t: TableNode, r: number, c: number, start: number, end: number, styleId: Id | null): TableNode {
  return withCellStory(t, r, c, (s) => applyCharStyle(s, start, end, styleId));
}

export function clearCellCharFormatting(t: TableNode, r: number, c: number, start: number, end: number): TableNode {
  return withCellStory(t, r, c, (s) => clearCharFormatting(s, start, end));
}

/** Lay out a cell's text inside its padded rectangle. */
export function layoutCell(t: TableNode, sheet: TextStyleSheet, r: number, c: number, measure: MeasureFn): { flow: FlowResult; style: TextStyle; props: CellProps; rect: { x: number; y: number; w: number; h: number } } {
  const rect = cellRect(t, r, c);
  const props = resolveCell(t, sheet, r, c);
  const style = cellTextStyle(props);
  const story: Story = { id: '_', text: t.cells[r][c].text, style, chain: [], spans: t.cells[r][c].spans };
  const flow = flowRichStory(story, sheet, [{ id: 'cell', w: rect.w, h: rect.h, padding: props.padding, columns: 1, columnGap: 0, vAlign: props.vAlign }], measure);
  return { flow, style, props, rect };
}

// ---------------------------------------------------------------------------
// Editing (all return a new node)

function mapCell(t: TableNode, r: number, c: number, fn: (cell: TableCell) => TableCell): TableNode {
  return { ...t, cells: t.cells.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? fn(cell) : cell)) : row)) };
}

/** New cell text; character formatting stays attached to the right characters. */
export function setCellText(t: TableNode, r: number, c: number, text: string): TableNode {
  if (!t.cells[r]?.[c]?.spans?.length) return mapCell(t, r, c, (cell) => ({ ...cell, text }));
  return withCellStory(t, r, c, (s) => replaceStoryText(s, text));
}

/** Cells in a rectangular range (anchors only). */
export function cellsInRange(t: TableNode, r0: number, c0: number, r1: number, c1: number): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  const seen = new Set<string>();
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
      const a = anchorOf(t, r, c);
      const k = `${a.r}:${a.c}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(a);
      }
    }
  }
  return out;
}

export function setCellStyle(t: TableNode, cells: { r: number; c: number }[], styleId: Id | null, clearLocal = true): TableNode {
  let out = t;
  for (const { r, c } of cells) out = mapCell(out, r, c, (cell) => ({ ...cell, styleId, props: clearLocal ? undefined : cell.props }));
  return out;
}

export function setCellProps(t: TableNode, cells: { r: number; c: number }[], props: Partial<CellProps>): TableNode {
  let out = t;
  for (const { r, c } of cells) {
    out = mapCell(out, r, c, (cell) => ({ ...cell, props: { ...(cell.props ?? {}), ...props, text: { ...(cell.props?.text ?? {}), ...(props.text ?? {}) } } }));
  }
  return out;
}

/** Merge a rectangular range; texts of the merged cells are kept, one per paragraph. */
export function mergeCells(t: TableNode, r0: number, c0: number, r1: number, c1: number): TableNode {
  let ra = Math.min(r0, r1);
  let ca = Math.min(c0, c1);
  let rb = Math.max(r0, r1);
  let cb = Math.max(c0, c1);
  // grow the range to include any merge it cuts through
  let grew = true;
  while (grew) {
    grew = false;
    for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) {
      const a = anchorOf(t, r, c);
      const cell = t.cells[a.r][a.c];
      const er = a.r + (cell.rowSpan ?? 1) - 1;
      const ec = a.c + (cell.colSpan ?? 1) - 1;
      if (a.r < ra || a.c < ca || er > rb || ec > cb) {
        ra = Math.min(ra, a.r); ca = Math.min(ca, a.c); rb = Math.max(rb, er); cb = Math.max(cb, ec);
        grew = true;
      }
    }
  }
  if (ra === rb && ca === cb) return t;
  const texts: string[] = [];
  const spans: CharSpan[] = [];
  let at = 0;
  for (const { r, c } of cellsInRange(t, ra, ca, rb, cb)) {
    const cl = t.cells[r][c];
    if (!cl.text) continue;
    if (texts.length) at += 1; // the paragraph break between merged texts
    for (const sp of cl.spans ?? []) spans.push({ ...sp, start: sp.start + at, end: sp.end + at });
    texts.push(cl.text);
    at += cl.text.length;
  }
  const cells = t.cells.map((row, r) => row.map((cell, c) => {
    if (r < ra || r > rb || c < ca || c > cb) return cell;
    if (r === ra && c === ca) {
      const merged: TableCell = { ...cell, text: texts.join('\n'), rowSpan: rb - ra + 1, colSpan: cb - ca + 1 };
      if (spans.length) merged.spans = normaliseSpans(spans);
      else delete merged.spans;
      return merged;
    }
    return { text: '' };
  }));
  return { ...t, cells };
}

/** Split a merged cell back into single cells (the text stays in the top-left one). */
export function splitCell(t: TableNode, r: number, c: number): TableNode {
  const a = anchorOf(t, r, c);
  return mapCell(t, a.r, a.c, (cell) => {
    const next = { ...cell };
    delete next.rowSpan;
    delete next.colSpan;
    return next;
  });
}

/** Insert a row before `at` (rowCount = append); height copies the neighbour; merges spanning it grow. */
export function insertRow(t: TableNode, at: number): TableNode {
  const n = rowCount(t);
  const i = Math.max(0, Math.min(n, at));
  const ref = t.rowHeights[Math.min(i, n - 1)] ?? 32;
  const rowHeights = [...t.rowHeights];
  rowHeights.splice(i, 0, ref);
  const cells = t.cells.map((row, r) => row.map((cell) => {
    const rs = cell.rowSpan ?? 1;
    return rs > 1 && r < i && r + rs > i ? { ...cell, rowSpan: rs + 1 } : cell;
  }));
  cells.splice(i, 0, Array.from({ length: colCount(t) }, () => ({ text: '' })));
  const scale = (t.h + ref * (t.h / (t.rowHeights.reduce((a, b) => a + b, 0) || 1))) / t.h;
  return { ...t, rowHeights, cells, h: t.h * scale, headerRows: i < t.headerRows ? t.headerRows + 1 : t.headerRows };
}

export function deleteRow(t: TableNode, at: number): TableNode {
  if (rowCount(t) <= 1 || at < 0 || at >= rowCount(t)) return t;
  const sum = t.rowHeights.reduce((a, b) => a + b, 0) || 1;
  const removedH = (t.rowHeights[at] * t.h) / sum;
  // merges crossing the row shrink by one
  const cells = t.cells.map((row, r) => row.map((cell) => {
    const rs = cell.rowSpan ?? 1;
    return r < at && r + rs > at ? { ...cell, rowSpan: rs - 1 } : cell;
  }));
  // an anchor on the deleted row hands its merge (and text) to the row below
  const below = cells[at + 1];
  if (below) {
    cells[at].forEach((cell, c) => {
      const rs = cell.rowSpan ?? 1;
      if (rs > 1) below[c] = { ...cell, rowSpan: rs - 1 };
    });
  }
  cells.splice(at, 1);
  const rowHeights = t.rowHeights.filter((_, i) => i !== at);
  return { ...t, rowHeights, cells, h: Math.max(1, t.h - removedH), headerRows: at < t.headerRows ? t.headerRows - 1 : t.headerRows };
}

export function insertColumn(t: TableNode, at: number): TableNode {
  const n = colCount(t);
  const i = Math.max(0, Math.min(n, at));
  const ref = t.colWidths[Math.min(i, n - 1)] ?? 80;
  const colWidths = [...t.colWidths];
  colWidths.splice(i, 0, ref);
  const sum = t.colWidths.reduce((a, b) => a + b, 0) || 1;
  const cells = t.cells.map((row) => {
    const next = row.map((cell, c) => {
      const cs = cell.colSpan ?? 1;
      return cs > 1 && c < i && c + cs > i ? { ...cell, colSpan: cs + 1 } : cell;
    });
    next.splice(i, 0, { text: '' });
    return next;
  });
  return { ...t, colWidths, cells, w: t.w + (ref * t.w) / sum };
}

export function deleteColumn(t: TableNode, at: number): TableNode {
  if (colCount(t) <= 1 || at < 0 || at >= colCount(t)) return t;
  const sum = t.colWidths.reduce((a, b) => a + b, 0) || 1;
  const removedW = (t.colWidths[at] * t.w) / sum;
  const cells = t.cells.map((row) => {
    const next = row.map((cell, c) => {
      const cs = cell.colSpan ?? 1;
      return c < at && c + cs > at ? { ...cell, colSpan: cs - 1 } : cell;
    });
    const victim = next[at];
    if ((victim.colSpan ?? 1) > 1 && next[at + 1]) next[at + 1] = { ...victim, colSpan: (victim.colSpan ?? 1) - 1 };
    next.splice(at, 1);
    return next;
  });
  return { ...t, colWidths: t.colWidths.filter((_, i) => i !== at), cells, w: Math.max(1, t.w - removedW) };
}

/** Grow rows so every cell's text fits (rows never shrink below their current height). */
export function fitRowsToContent(t: TableNode, sheet: TextStyleSheet, measure: MeasureFn): TableNode {
  const { rows } = scaledTracks(t);
  const need = [...rows];
  for (let r = 0; r < rowCount(t); r++) {
    for (let c = 0; c < colCount(t); c++) {
      if (isCovered(t, r, c) || (t.cells[r][c].rowSpan ?? 1) > 1) continue;
      const props = resolveCell(t, sheet, r, c);
      const style = cellTextStyle(props);
      const rect = cellRect(t, r, c);
      const f = flowRichStory({ id: '_', text: t.cells[r][c].text, style, chain: [], spans: t.cells[r][c].spans }, sheet, [{ id: 'x', w: rect.w, h: 100000, padding: props.padding, columns: 1, columnGap: 0 }], measure);
      const lines = f.frames.x.lines;
      const last = lines[lines.length - 1];
      const h = last ? last.y + (last.height ?? style.fontSize * style.lineHeight) + props.padding : 0;
      need[r] = Math.max(need[r], h);
    }
  }
  const total = need.reduce((a, b) => a + b, 0);
  return { ...t, rowHeights: need, h: total };
}

/** Overset cells (text that does not fit), for the overflow marker and preflight. */
export function oversetCells(t: TableNode, sheet: TextStyleSheet, measure: MeasureFn): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let r = 0; r < rowCount(t); r++) for (let c = 0; c < colCount(t); c++) {
    if (isCovered(t, r, c) || !t.cells[r][c].text) continue;
    if (layoutCell(t, sheet, r, c, measure).flow.overflow) out.push({ r, c });
  }
  return out;
}

/** Tab-separated text → table cells (paste / convert text to table). */
export function tableFromText(text: string, init: Partial<TableNode> = {}): TableNode {
  const rows = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1).map((l) => l.split('\t'));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const t = makeTable(Math.max(1, rows.length), cols, init);
  return { ...t, cells: t.cells.map((row, r) => row.map((cell, c) => ({ ...cell, text: rows[r]?.[c] ?? '' }))) };
}

export function paintColour(p: Paint): string | null {
  return p.type === 'solid' ? p.color : null;
}
