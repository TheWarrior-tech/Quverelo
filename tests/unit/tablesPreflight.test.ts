import { describe, expect, it } from 'vitest';
import { createDocument, make } from '../../src/core/document';
import { addNodes, addTextFrame } from '../../src/core/commands';
import {
  anchorOf, cellAt, cellRect, cellsInRange, deleteColumn, deleteRow, fitRowsToContent, insertColumn, insertRow, isCovered, makeTable,
  mergeCells, oversetCells, resolveCell, scaledTracks, setCellProps, setCellStyle, setCellText, splitCell, tableFromText,
} from '../../src/core/tables';
import { addCellStyle, deleteTextStyle, updateTextStyle } from '../../src/core/typography';
import { effectivePpi, fontsUsed, registerPreflightCheck, runPreflight, type PreflightEnv } from '../../src/core/preflight';
import { flowRichStory, monoMeasure } from '../../src/core/textflow';
import { findNode } from '../../src/core/document';
import type { QuvreloDocument, SceneNode, TableNode } from '../../src/core/types';

const m = monoMeasure(0.5);
const sheet = { paragraph: [], character: [], cell: [] };

describe('tables', () => {
  it('creates a grid sized to w/h', () => {
    const t = makeTable(3, 4, { w: 400, h: 90 });
    expect(t.cells).toHaveLength(3);
    expect(t.cells[0]).toHaveLength(4);
    expect(cellRect(t, 1, 2)).toEqual({ x: 200, y: 30, w: 100, h: 30 });
  });
  it('scales tracks when the table is resized', () => {
    const t = { ...makeTable(2, 2, { w: 100, h: 50 }), w: 200 };
    expect(scaledTracks(t).cols).toEqual([100, 100]);
  });
  it('merges and splits cells, keeping text', () => {
    let t = makeTable(3, 3, { w: 300, h: 90 });
    t = setCellText(setCellText(t, 0, 0, 'A'), 1, 1, 'B');
    t = mergeCells(t, 0, 0, 1, 1);
    expect(t.cells[0][0]).toMatchObject({ text: 'A\nB', rowSpan: 2, colSpan: 2 });
    expect(isCovered(t, 1, 1)).toBe(true);
    expect(anchorOf(t, 1, 0)).toEqual({ r: 0, c: 0 });
    expect(cellRect(t, 0, 0)).toEqual({ x: 0, y: 0, w: 200, h: 60 });
    expect(cellAt(t, 150, 50)).toEqual({ r: 0, c: 0 });
    expect(cellsInRange(t, 0, 0, 2, 2)).toHaveLength(6);
    t = splitCell(t, 1, 1);
    expect(isCovered(t, 1, 1)).toBe(false);
  });
  it('a merge grows to cover merges it cuts through', () => {
    let t = makeTable(3, 3);
    t = mergeCells(t, 0, 1, 1, 2);
    t = mergeCells(t, 1, 0, 1, 1);
    expect(t.cells[0][0]).toMatchObject({ rowSpan: 2, colSpan: 3 });
  });
  it('inserts and deletes rows and columns, adjusting merges and size', () => {
    let t = makeTable(2, 2, { w: 200, h: 60 });
    t = mergeCells(t, 0, 0, 1, 0);
    t = insertRow(t, 1);
    expect(t.cells).toHaveLength(3);
    expect(t.cells[0][0].rowSpan).toBe(3);
    expect(t.h).toBeCloseTo(90);
    t = deleteRow(t, 0);
    expect(t.cells).toHaveLength(2);
    expect(t.cells[0][0].rowSpan).toBe(2);
    t = insertColumn(t, 2);
    expect(t.colWidths).toHaveLength(3);
    expect(t.w).toBeCloseTo(300);
    t = deleteColumn(t, 0);
    expect(t.cells[0]).toHaveLength(2);
    expect(t.w).toBeCloseTo(200);
  });
  it('resolves cell styles: defaults, header row, named style, local props; editing the style updates cells', () => {
    let doc = createDocument();
    const cs = addCellStyle(doc, { name: 'Total', props: { fill: { type: 'solid', color: '#ffeeaa' }, text: { fontWeight: 700 } } });
    doc = cs.doc;
    let t = { ...makeTable(2, 2), headerRows: 1 };
    t = setCellStyle(t, [{ r: 1, c: 1 }], cs.id);
    t = setCellProps(t, [{ r: 1, c: 1 }], { padding: 2 });
    expect(resolveCell(t, doc.textStyles!, 0, 0).text.fontWeight).toBe(700);
    const p = resolveCell(t, doc.textStyles!, 1, 1);
    expect(p.fill).toEqual({ type: 'solid', color: '#ffeeaa' });
    expect(p.padding).toBe(2);
    doc = updateTextStyle(doc, 'cell', cs.id, { props: { fill: { type: 'solid', color: '#000000' } } });
    expect(resolveCell(t, doc.textStyles!, 1, 1).fill).toEqual({ type: 'solid', color: '#000000' });
    // deleting the style keeps the look on the cell
    doc = addNodes(doc, doc.pages[0].id, [t]);
    doc = deleteTextStyle(doc, 'cell', cs.id);
    const after = findNode(doc, t.id)!.node as TableNode;
    expect(resolveCell(after, doc.textStyles!, 1, 1).fill).toEqual({ type: 'solid', color: '#000000' });
  });
  it('finds overset cells and fits rows to content', () => {
    let t = makeTable(1, 1, { w: 50, h: 20 });
    t = setCellText(t, 0, 0, 'a fairly long cell text that wraps');
    expect(oversetCells(t, sheet, m)).toHaveLength(1);
    t = fitRowsToContent(t, sheet, m);
    expect(t.h).toBeGreaterThan(20);
    expect(oversetCells(t, sheet, m)).toHaveLength(0);
  });
  it('converts tab-separated text', () => {
    const t = tableFromText('a\tb\nc\td\te');
    expect(t.cells.map((r) => r.map((c) => c.text))).toEqual([['a', 'b', ''], ['c', 'd', 'e']]);
  });
});

function env(over: Partial<PreflightEnv> = {}): PreflightEnv {
  return {
    flow: (d: QuvreloDocument, id: string) => {
      const s = d.stories[id];
      const frames = s.chain.map((f) => findNode(d, f)!.node).filter((n): n is Extract<SceneNode, { type: 'textframe' }> => n.type === 'textframe');
      return flowRichStory(s, d.textStyles ?? sheet, frames, m);
    },
    measure: m,
    fontAvailable: (f) => f === 'Inter' || f === 'EB Garamond',
    ...over,
  };
}

describe('preflight', () => {
  it('flags overset text with the page and frame', () => {
    let doc = createDocument({ pages: 2 });
    const t = addTextFrame(doc, doc.pages[1].id, { w: 40, h: 12 }, 'this text cannot possibly fit in here', { fontSize: 10, lineHeight: 1 });
    doc = t.doc;
    const issues = runPreflight(doc, env());
    const o = issues.find((i) => i.check === 'overset-text')!;
    expect(o.severity).toBe('error');
    expect(o.pageIndex).toBe(1);
    expect(o.nodeId).toBe(t.id);
    expect(o.detail).toMatch(/words? hidden/);
  });
  it('flags missing fonts, including ones only used in a character run', () => {
    let doc = createDocument();
    const t = addTextFrame(doc, doc.pages[0].id, { w: 400, h: 100 }, 'hello', { fontFamily: 'Inter' });
    doc = t.doc;
    const sid = (findNode(doc, t.id)!.node as Extract<SceneNode, { type: 'textframe' }>).storyId;
    doc = { ...doc, stories: { ...doc.stories, [sid]: { ...doc.stories[sid], spans: [{ start: 0, end: 2, props: { fontFamily: 'Futura PT' } }] } } };
    expect([...fontsUsed(doc).keys()]).toEqual(expect.arrayContaining(['Inter', 'Futura PT']));
    const issues = runPreflight(doc, env()).filter((i) => i.check === 'missing-fonts');
    expect(issues.map((i) => i.message)).toEqual(['Missing font: Futura PT']);
  });
  it('flags low-resolution and missing images', () => {
    expect(effectivePpi(300, 300, 96, 96)).toBe(300);
    let doc = createDocument();
    doc = { ...doc, assets: { a1: { id: 'a1', name: 'x.jpg', mime: 'image/jpeg', width: 100, height: 100 } } };
    doc = addNodes(doc, doc.pages[0].id, [
      make.imageframe({ assetId: 'a1', w: 192, h: 192, fit: 'fit' }),
      make.imageframe({ assetId: 'gone', w: 10, h: 10 }),
      make.imageframe({ w: 10, h: 10 }),
    ]);
    const issues = runPreflight(doc, env()).filter((i) => i.check === 'images');
    expect(issues.map((i) => [i.message, i.severity])).toEqual([['Low-resolution image', 'error'], ['Missing image', 'error'], ['Empty picture frame', 'info']]);
    expect(issues[0].detail).toMatch(/^50 ppi/);
  });
  it('flags items left on the pasteboard', () => {
    let doc = createDocument({ settings: { width: 100, height: 100 } });
    doc = addNodes(doc, doc.pages[0].id, [make.rect({ x: 500, y: 500, w: 10, h: 10 })]);
    expect(runPreflight(doc, env()).some((i) => i.check === 'off-page')).toBe(true);
  });
  it('runs checks registered by other modules (colour hook) and can disable checks', () => {
    const off = registerPreflightCheck({ id: 'rgb-in-cmyk', label: 'RGB in CMYK', run: () => [{ id: 'x', check: 'rgb-in-cmyk', severity: 'warning', message: 'RGB colour', pageIndex: 0 }] });
    const doc = createDocument();
    expect(runPreflight(doc, env()).map((i) => i.check)).toContain('rgb-in-cmyk');
    expect(runPreflight(doc, env(), ['rgb-in-cmyk']).map((i) => i.check)).not.toContain('rgb-in-cmyk');
    off();
    expect(runPreflight(doc, env()).map((i) => i.check)).not.toContain('rgb-in-cmyk');
  });
  it('a crashing check is reported, not thrown', () => {
    const off = registerPreflightCheck({ id: 'boom', label: 'Boom', run: () => { throw new Error('bad'); } });
    expect(runPreflight(createDocument(), env()).find((i) => i.check === 'boom')?.message).toBe('Boom could not run');
    off();
  });
  it('flags overset table cells', () => {
    let doc = createDocument();
    const t = setCellText(makeTable(1, 1, { w: 30, h: 10 }), 0, 0, 'much too much text');
    doc = addNodes(doc, doc.pages[0].id, [t]);
    expect(runPreflight(doc, env()).find((i) => i.nodeId === t.id)?.message).toBe('Overset table cell');
  });
});
