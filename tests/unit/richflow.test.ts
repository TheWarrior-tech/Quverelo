import { describe, expect, it } from 'vitest';
import { createStory } from '../../src/core/document';
import { blockedIntervals, caretX, flowRichStory, freeSegments, indexAtX, monoMeasure, type FlowFrame } from '../../src/core/textflow';
import { applyCharProps, applyParaProps, FIELD_PAGE, FIELD_PAGE_COUNT } from '../../src/core/typography';

const m = monoMeasure(0.5);
const sheet = { paragraph: [], character: [], cell: [] };
const frame = (o: Partial<FlowFrame> = {}): FlowFrame => ({ id: 'f', w: 200, h: 200, padding: 0, columns: 1, columnGap: 0, ...o });
const base = { fontSize: 10, lineHeight: 1 }; // mono: 5 px per char, 10 px lines

describe('rich text flow', () => {
  it('measures each run in its own size and leads the line by the largest', () => {
    let s = createStory('aa bb', base);
    s = applyCharProps(s, 3, 5, { fontSize: 20 });
    const r = flowRichStory(s, sheet, [frame()], m);
    const l = r.frames.f.lines[0];
    expect(l.runs!.map((x) => [x.text, x.x, x.width])).toEqual([['aa ', 0, 15], ['bb', 15, 20]]);
    expect(l.height).toBe(20);
    expect(l.width).toBe(35);
  });

  it('applies space before/after (not at the top of a column) and indents', () => {
    let s = createStory('a\nb\nc', base);
    s = applyParaProps(s, 0, 0, { spaceBefore: 50, spaceAfter: 5 });
    s = applyParaProps(s, 2, 2, { spaceBefore: 7, leftIndent: 20, firstIndent: 10 });
    const lines = flowRichStory(s, sheet, [frame()], m).frames.f.lines;
    expect(lines.map((l) => l.y)).toEqual([0, 22, 32]);
    expect(lines[1].x).toBe(30);
    expect(lines[2].x).toBe(0);
  });

  it('first-line indent only on the first line of a paragraph', () => {
    let s = createStory('aaaa bbbb cccc', base);
    s = applyParaProps(s, 0, 0, { firstIndent: 10, leftIndent: 5 });
    const lines = flowRichStory(s, sheet, [frame({ w: 60 })], m).frames.f.lines;
    expect(lines[0].x).toBe(15);
    expect(lines[1].x).toBe(5);
  });

  it('justifies all but the last line of a paragraph', () => {
    let s = createStory('aa bb cc dd ee', base);
    s = applyParaProps(s, 0, 0, { align: 'justify' });
    const lines = flowRichStory(s, sheet, [frame({ w: 38 })], m).frames.f.lines;
    expect(lines[0].text).toBe('aa bb');
    expect(lines[0].wordSpacing).toBeCloseTo(38 - 25);
    expect(lines[0].runs![0].wordSpacing).toBeCloseTo(13);
    const last = lines[lines.length - 1];
    expect(last.wordSpacing).toBe(0);
  });

  it('snaps baselines to the baseline grid when the paragraph asks for it', () => {
    let s = createStory('a\nb', { ...base, lineHeight: 1.2 });
    s = applyParaProps(s, 0, 2, { alignToGrid: true });
    const r = flowRichStory(s, sheet, [frame({ pageTop: 100 })], m, { grid: { start: 36, increment: 18 } });
    const pageBaselines = r.frames.f.lines.map((l) => 100 + l.baseline!);
    for (const b of pageBaselines) expect((b - 36) % 18).toBeCloseTo(0);
    expect(pageBaselines[1] - pageBaselines[0]).toBe(18);
  });

  it('wraps text around an exclusion, using both sides when there is room', () => {
    const text = Array.from({ length: 60 }, () => 'ab').join(' ');
    const s = createStory(text, base);
    const ex = [{ kind: 'box' as const, pts: [{ x: 80, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 30 }, { x: 80, y: 30 }], offset: 0 }];
    const lines = flowRichStory(s, sheet, [frame({ exclusions: ex })], m).frames.f.lines;
    const top = lines.filter((l) => l.y === 0);
    expect(top).toHaveLength(2);
    expect(top[0].x + top[0].width).toBeLessThanOrEqual(80);
    expect(top[1].x).toBeGreaterThanOrEqual(120);
    const below = lines.filter((l) => l.y >= 30);
    expect(below[0].width).toBeGreaterThan(120);
  });

  it('jump wrap leaves the band empty', () => {
    const s = createStory('aa bb cc dd ee ff gg hh', base);
    const ex = [{ kind: 'jump' as const, pts: [{ x: 50, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 25 }, { x: 50, y: 25 }], offset: 0 }];
    const lines = flowRichStory(s, sheet, [frame({ exclusions: ex })], m).frames.f.lines;
    expect(lines[0].y).toBeGreaterThanOrEqual(25);
  });

  it('computes blocked intervals for contours and drops narrow gaps', () => {
    const tri = { kind: 'contour' as const, pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], offset: 0 };
    expect(blockedIntervals([tri], 50, 60)[0][1]).toBeCloseTo(60);
    expect(freeSegments(0, 100, [[10, 95]], 8)).toEqual([[0, 10]]);
  });

  it('replaces page fields with the frame\'s page number', () => {
    const s = createStory(`Page ${FIELD_PAGE} of ${FIELD_PAGE_COUNT}`, base);
    const r = flowRichStory(s, sheet, [frame({ fields: { page: '12', pageCount: '40', section: '' } })], m);
    expect(r.frames.f.lines[0].text).toBe('Page 12 of 40');
    expect(r.frames.f.lines[0].end).toBe(s.text.length);
  });

  it('threads through frames and columns and reports overset', () => {
    const s = createStory(Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '), base);
    const r = flowRichStory(s, sheet, [frame({ id: 'a', w: 50, h: 30 }), frame({ id: 'b', w: 110, h: 20, columns: 2, columnGap: 10 })], m);
    expect(r.frames.b.start).toBe(r.frames.a.end);
    expect(r.frames.b.lines[2].x).toBe(60);
    expect(r.overflow).toBe(true);
    expect(r.overflowAt).toBe(r.frames.b.end);
  });

  it('moves a too-tall line to the next column instead of clipping it', () => {
    let s = createStory('aa bb', base);
    s = applyCharProps(s, 3, 5, { fontSize: 30 });
    const r = flowRichStory(s, sheet, [frame({ id: 'a', w: 15, h: 20 }), frame({ id: 'b', w: 200, h: 200 })], m);
    expect(r.frames.a.lines.map((l) => l.text)).toEqual(['aa']);
    expect(r.frames.b.lines[0].text).toBe('bb');
  });

  it('maps between caret indices and x positions', () => {
    let s = createStory('abc def', base);
    s = applyCharProps(s, 4, 7, { fontSize: 20 });
    const line = flowRichStory(s, sheet, [frame()], m).frames.f.lines[0];
    expect(caretX(line, 2, m)).toBe(10);
    expect(caretX(line, 5, m)).toBe(30);
    expect(indexAtX(line, 31, m)).toBe(5);
    expect(indexAtX(line, 1000, m)).toBe(7);
  });

  it('superscript runs are smaller and raised', () => {
    let s = createStory('x2', base);
    s = applyCharProps(s, 1, 2, { position: 'superscript' });
    const run = flowRichStory(s, sheet, [frame()], m).frames.f.lines[0].runs![1];
    expect(run.width).toBeCloseTo(3);
    expect(run.rise).toBeGreaterThan(0);
  });
});
