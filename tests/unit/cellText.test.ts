/** Per-character formatting inside Layout table cells: model, editing, flow, merge, styles. */
import { describe, expect, it } from 'vitest';
import {
  applyCellCharProps, applyCellCharStyle, cellStory, cellStoryId, layoutCell, makeTable, mergeCells, setCellText,
} from '../../src/core/tables';
import { addCharacterStyle, deleteTextStyle, emptySheet, styleUsage } from '../../src/core/typography';
import { createDocument } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { monoMeasure } from '../../src/core/textflow';
import type { TableNode } from '../../src/core/types';

const m = monoMeasure(0.5);
const sheet = emptySheet();

describe('table cell character formatting', () => {
  it('formats a word inside a cell and lays it out as its own run', () => {
    let t = makeTable(2, 2, { w: 400, h: 100 });
    t = setCellText(t, 0, 0, 'Total 12.50 GBP');
    t = applyCellCharProps(t, 0, 0, 6, 11, { fontWeight: 700, figureSpacing: 'tabular' });
    expect(t.cells[0][0].spans).toEqual([{ start: 6, end: 11, styleId: null, props: { fontWeight: 700, figureSpacing: 'tabular' } }]);
    const runs = layoutCell(t, sheet, 0, 0, m).flow.frames.cell.lines[0].runs!;
    expect(runs.map((r) => r.text)).toEqual(['Total ', '12.50', ' GBP']);
    expect(runs[1].style.fontWeight).toBe(700);
    expect(runs[0].style.fontWeight).not.toBe(700);
  });

  it('typing keeps the formatting attached to the right characters', () => {
    let t = makeTable(1, 1, { w: 200, h: 40 });
    t = setCellText(t, 0, 0, 'abc def');
    t = applyCellCharProps(t, 0, 0, 4, 7, { italic: true });
    t = setCellText(t, 0, 0, 'XX abc def'); // typed at the start
    expect(t.cells[0][0].spans).toEqual([{ start: 7, end: 10, styleId: null, props: { italic: true } }]);
    t = setCellText(t, 0, 0, 'XX abc'); // deleted the formatted word
    expect(t.cells[0][0].spans).toBeUndefined();
  });

  it('a cell reads as a story with the cell text style as its base', () => {
    let t = makeTable(2, 2, { w: 400, h: 100, headerRows: 1 });
    t = setCellText(t, 0, 1, 'Head');
    const st = cellStory(t, sheet, 0, 1);
    expect(st.id).toBe(cellStoryId(t.id, 0, 1));
    expect(st.text).toBe('Head');
    expect(st.style.fontWeight).toBe(700); // header row
  });

  it('merging cells keeps each text’s formatting at its new offset', () => {
    let t = makeTable(1, 2, { w: 400, h: 40 });
    t = setCellText(t, 0, 0, 'one');
    t = setCellText(t, 0, 1, 'two');
    t = applyCellCharProps(t, 0, 1, 0, 3, { underline: true });
    t = mergeCells(t, 0, 0, 0, 1);
    expect(t.cells[0][0].text).toBe('one\ntwo');
    expect(t.cells[0][0].spans).toEqual([{ start: 4, end: 7, styleId: null, props: { underline: true } }]);
  });

  it('character styles in cells are counted, and deleting the style keeps the look', () => {
    let d = createDocument({ settings: { width: 400, height: 300 } });
    const cs = addCharacterStyle(d, { name: 'Strong', props: { fontWeight: 700 } });
    d = cs.doc;
    let t: TableNode = setCellText(makeTable(1, 1, { w: 200, h: 40 }), 0, 0, 'big deal');
    t = applyCellCharStyle(t, 0, 0, 0, 3, cs.id);
    d = addNodes(d, d.pages[0].id, [t]);
    expect(styleUsage(d, 'character', cs.id)).toBe(1);
    d = deleteTextStyle(d, 'character', cs.id);
    const cell = (d.pages[0].nodes[0] as TableNode).cells[0][0];
    expect(cell.spans).toEqual([{ start: 0, end: 3, styleId: null, props: { fontWeight: 700 } }]);
  });
});
