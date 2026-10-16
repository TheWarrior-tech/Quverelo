/** IDML rich text: named style sheet, per-paragraph / per-character styles with overrides, tables (Layout model shapes). */
import { describe, expect, it } from 'vitest';
import { styledIdml } from '../fixtures/interop';
import { importIdml } from '../../src/core/interop/idml';
import { MODEL_HAS_RICH_TEXT, MODEL_HAS_TABLES } from '../../src/core/interop/idmlRich';
import type { Story, TableNode } from '../../src/core/types';
import { tablesToNodes, type RichStory } from '../../src/core/interop/idmlRich';
import { isCovered } from '../../src/core/tables';

const PT = 96 / 72;

describe('IDML rich text and tables', () => {
  it('builds the named style sheet with BasedOn chains, Next style and complete root styles', async () => {
    const r = await importIdml(await styledIdml(), 'Styled');
    const sheet = r.rich!.sheet;
    const byName = (n: string) => sheet.paragraph.find((p) => p.name === n)!;
    expect(sheet.paragraph.map((p) => p.name)).toEqual(['[No paragraph style]', 'Heading', 'Body']);
    const root = byName('[No paragraph style]');
    expect(root.basedOn).toBeNull();
    expect(root.props).toMatchObject({ fontSize: 12 * PT, fontWeight: 400, italic: false, leading: 0 });
    const heading = byName('Heading');
    expect(heading.basedOn).toBe(root.id);
    expect(heading.nextStyle).toBe(byName('Body').id);
    expect(heading.props).toMatchObject({ fontSize: 24 * PT, fontWeight: 700, fill: { type: 'solid', color: '#1f2a44' }, spaceAfter: 6 * PT, keepWithNext: true });
    expect(byName('Body').props).toMatchObject({ fontSize: 10 * PT, leading: 14 * PT, firstIndent: 12 * PT, align: 'justify' });
    expect(sheet.character.map((c) => c.name)).toEqual(['Strong', 'Super']);
    const strong = sheet.character.find((c) => c.name === 'Strong')!;
    expect(strong.props).toEqual({ fontWeight: 700, italic: false, fill: { type: 'solid', color: '#d9b44a' } });
    expect(sheet.character.find((c) => c.name === 'Super')).toMatchObject({ basedOn: strong.id, props: { position: 'superscript' } });
    expect(sheet.cell).toEqual([expect.objectContaining({ name: 'Head', props: { fill: { type: 'solid', color: '#1f2a44' }, padding: 4 * PT, vAlign: 'middle' } })]);
    // the sheet is on the document under the Layout model's field name
    expect((r.doc as unknown as { textStyles: unknown }).textStyles).toBe(sheet);
  });

  it('maps paragraph styles, character styles and local overrides onto ranges of the story', async () => {
    const r = await importIdml(await styledIdml(), 'Styled');
    const story = Object.values(r.doc.stories)[0] as Story & { spans: { start: number; end: number; styleId?: string; props?: Record<string, unknown> }[]; paras: ({ styleId?: string; props?: Record<string, unknown> } | null)[] };
    const sheet = r.rich!.sheet;
    const pid = (n: string) => sheet.paragraph.find((p) => p.name === n)!.id;
    const cid = (n: string) => sheet.character.find((p) => p.name === n)!.id;
    const lines = story.text.split('\n');
    expect(lines[0]).toBe('Year 9 Art');
    expect(lines[1]).toBe('Mix primary colours1');
    expect(lines.at(-1)).toBe('After the table');
    // the table became a TableNode, so its fallback paragraphs left the text
    expect(lines).toEqual(['Year 9 Art', 'Mix primary colours1', 'After the table']);
    expect(story.paras).toEqual([{ styleId: pid('Heading') }, { styleId: pid('Body') }, { styleId: pid('Body') }]);
    const at = (word: string) => story.text.indexOf(word);
    const spanAt = (i: number) => story.spans.find((s) => i >= s.start && i < s.end);
    expect(spanAt(at('primary'))).toEqual({ start: at('primary'), end: at('primary') + 7, styleId: cid('Strong') });
    expect(spanAt(at(' colours'))).toEqual({ start: at(' colours'), end: at(' colours') + 8, props: { fontSize: 14 * PT, underline: true } });
    expect(spanAt(at('colours1') + 7)?.styleId).toBe(cid('Super'));
    expect(spanAt(at('Mix'))).toBeUndefined(); // plain text has no span
    // spans are sorted and never overlap
    for (let i = 1; i < story.spans.length; i++) expect(story.spans[i].start).toBeGreaterThanOrEqual(story.spans[i - 1].end);
    // the story's base style is the first run's; paragraph styles (complete root styles) override it per paragraph
    expect(story.style.fontSize).toBeCloseTo(24 * PT);
    expect(MODEL_HAS_RICH_TEXT).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/first style for now/);
  });

  it('reads tables (header rows, sizes, merged cells, cell styles) with where their fallback sat', async () => {
    const r = await importIdml(await styledIdml(), 'Styled');
    const [t] = Object.values(r.rich!.stories)[0].tables;
    expect(t.headerRows).toBe(1);
    expect(t.colWidths).toEqual([120 * PT, 200 * PT]);
    expect(t.rowHeights).toEqual([20 * PT, 18 * PT, 18 * PT]);
    expect(t.cells.map((row) => row.map((c) => c.text))).toEqual([['Colour', 'Mix'], ['Green', 'Blue + yellow'], ['Teal', '']]);
    expect(t.cells[1][1].rowSpan).toBe(2);
    const head = r.rich!.sheet.cell.find((c) => c.name === 'Head')!;
    expect(t.cells[0][0].styleId).toBe(head.id);
  });

  it('places each table as a Layout TableNode next to its text frame, with a jump wrap', async () => {
    expect(MODEL_HAS_TABLES).toBe(true);
    const r = await importIdml(await styledIdml(), 'Styled');
    const nodes = r.doc.pages[0].nodes;
    const fi = nodes.findIndex((n) => n.type === 'textframe');
    const table = nodes[fi + 1] as TableNode;
    expect(table.type).toBe('table');
    expect(table.headerRows).toBe(1);
    expect(table.w).toBeCloseTo(320 * PT);
    expect(table.colWidths).toEqual([120 * PT, 200 * PT]);
    // rows grow to fit their text like InDesign's auto-grow rows: Body 14pt leading + 4pt insets top and bottom
    table.rowHeights.forEach((h) => expect(h).toBeCloseTo(22 * PT));
    expect(table.h).toBeCloseTo(66 * PT);
    // cell text keeps its paragraph style's formatting; cells without an inset get InDesign's 4pt default
    expect(table.cells[1][0].props).toMatchObject({ padding: 4 * PT, text: { fontSize: 10 * PT, leading: 14 * PT } });
    expect(table.cells[0][0].props?.padding).toBeUndefined(); // from the Head cell style
    expect(table.cells.map((row) => row.map((c) => c.text))).toEqual([['Colour', 'Mix'], ['Green', 'Blue + yellow'], ['Teal', '']]);
    expect(table.cells[1][1].rowSpan).toBe(2);
    expect(isCovered(table, 2, 1)).toBe(true);
    expect(table.cells[0][0].styleId).toBe(r.rich!.sheet.cell.find((c) => c.name === 'Head')!.id);
    expect(table.wrap).toEqual({ mode: 'jump', offset: 4 * PT });
    // inside the frame: left edges line up, below the two paragraphs before it
    const frame = nodes[fi] as Extract<typeof nodes[number], { type: 'textframe' }>;
    expect(table.x - table.w / 2).toBeCloseTo(frame.x - frame.w / 2 + frame.padding);
    expect(table.y - table.h / 2).toBeGreaterThan(frame.y - frame.h / 2);
    expect(table.y + table.h / 2).toBeLessThanOrEqual(frame.y + frame.h / 2 + 1e-6);
    expect(r.warnings.join(' ')).not.toMatch(/tab-separated/);
    expect(r.warnings.join(' ')).toMatch(/Layout tables/);
  });

  it('takes table fallbacks out of the text and shifts spans and paragraph attributes', () => {
    // "A\n" + table (2 rows) + "\nB bold"
    const text = 'A\nx\ty\nz\tw\nB bold';
    const start = 2, end = 2 + 'x\ty\nz\tw'.length;
    const rich: RichStory = {
      spans: [{ start: text.indexOf('bold'), end: text.length, props: { fontWeight: 700 } }],
      paras: [{ styleId: 'h' }, { styleId: 't' }, { styleId: 't' }, { styleId: 'b' }],
      tables: [{ start, end, headerRows: 0, colWidths: [10, 20], rowHeights: [5, 5], cells: [[{ text: 'x' }, { text: 'y' }], [{ text: 'z' }, { text: 'w' }]] }],
    };
    const out = tablesToNodes(text, rich);
    expect(out.text).toBe('A\nB bold');
    expect(out.spans).toEqual([{ start: out.text.indexOf('bold'), end: out.text.length, props: { fontWeight: 700 } }]);
    expect(out.paras).toEqual([{ styleId: 'h' }, { styleId: 'b' }]);
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].parasBefore).toBe(1);
    expect(out.tables[0].node).toMatchObject({ type: 'table', w: 30, h: 10, colWidths: [10, 20], rowHeights: [5, 5] });
    // a table at the very end takes the paragraph break before it
    const end2 = tablesToNodes('A\nx\ty', { spans: [], paras: [null, null], tables: [{ start: 2, end: 5, headerRows: 0, colWidths: [1, 1], rowHeights: [1], cells: [[{ text: 'x' }, { text: 'y' }]] }] });
    expect(end2.text).toBe('A');
    expect(end2.paras).toEqual([null]);
  });
});
