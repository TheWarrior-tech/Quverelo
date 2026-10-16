/** IDML rich text: named style sheet, per-paragraph / per-character styles with overrides, tables (Layout model shapes). */
import { describe, expect, it } from 'vitest';
import { styledIdml } from '../fixtures/interop';
import { importIdml } from '../../src/core/interop/idml';
import { MODEL_HAS_RICH_TEXT, MODEL_HAS_TABLES } from '../../src/core/interop/idmlRich';
import type { Story } from '../../src/core/types';

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
    expect(story.paras[0]).toEqual({ styleId: pid('Heading') });
    expect(story.paras[1]).toEqual({ styleId: pid('Body') });
    // the table's paragraph keeps its local centring
    expect(story.paras[2]).toEqual({ styleId: pid('Body'), props: { align: 'center' } });
    const at = (word: string) => story.text.indexOf(word);
    const spanAt = (i: number) => story.spans.find((s) => i >= s.start && i < s.end);
    expect(spanAt(at('primary'))).toEqual({ start: at('primary'), end: at('primary') + 7, styleId: cid('Strong') });
    expect(spanAt(at(' colours'))).toEqual({ start: at(' colours'), end: at(' colours') + 8, props: { fontSize: 14 * PT, underline: true } });
    expect(spanAt(at('colours1') + 7)?.styleId).toBe(cid('Super'));
    expect(spanAt(at('Mix'))).toBeUndefined(); // plain text has no span
    // spans are sorted and never overlap
    for (let i = 1; i < story.spans.length; i++) expect(story.spans[i].start).toBeGreaterThanOrEqual(story.spans[i - 1].end);
    // main still draws one style per story: the first run's
    expect(story.style.fontSize).toBeCloseTo(24 * PT);
    if (!MODEL_HAS_RICH_TEXT) expect(r.warnings.join(' ')).toMatch(/first style for now/);
  });

  it('reads tables (header rows, sizes, merged cells, cell styles) and keeps a tab-separated fallback in the text', async () => {
    const r = await importIdml(await styledIdml(), 'Styled');
    const story = Object.values(r.doc.stories)[0];
    const [t] = Object.values(r.rich!.stories)[0].tables;
    expect(t.headerRows).toBe(1);
    expect(t.colWidths).toEqual([120 * PT, 200 * PT]);
    expect(t.rowHeights).toEqual([20 * PT, 18 * PT, 18 * PT]);
    expect(t.cells.map((row) => row.map((c) => c.text))).toEqual([['Colour', 'Mix'], ['Green', 'Blue + yellow'], ['Teal', '']]);
    expect(t.cells[1][1].rowSpan).toBe(2);
    const head = r.rich!.sheet.cell.find((c) => c.name === 'Head')!;
    expect(t.cells[0][0].styleId).toBe(head.id);
    expect(story.text.slice(t.start, t.end)).toBe('Colour\tMix\nGreen\tBlue + yellow\nTeal\t');
    if (!MODEL_HAS_TABLES) expect(r.warnings.join(' ')).toMatch(/tab-separated/);
  });
});
