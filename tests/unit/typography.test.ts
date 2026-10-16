import { describe, expect, it } from 'vitest';
import { createDocument, createStory } from '../../src/core/document';
import {
  addCharacterStyle, addParagraphStyle, applyCharProps, applyCharStyle, applyParaProps, applyParagraphStyle, deleteTextStyle,
  FIELD_PAGE, fieldText, mapSpanRange, normaliseSpans, paragraphRanges, rangeValue, replaceStoryText, resolveCharacterStyle,
  resolveParagraphStyle, sliceStory, styleAt, styledParagraphs, styleUsage, updateTextStyle, wouldCycle, defaultLayoutStyles,
} from '../../src/core/typography';
import type { QuvreloDocument, Story } from '../../src/core/types';

const sheetOf = (d: QuvreloDocument) => d.textStyles!;

function docWithStory(text: string): { doc: QuvreloDocument; story: Story } {
  const story = createStory(text, { fontSize: 10 });
  const doc = { ...createDocument(), stories: { [story.id]: story } };
  return { doc, story };
}

describe('paragraph and character styles', () => {
  it('resolves based-on chains, child wins', () => {
    let { doc } = docWithStory('x');
    const a = addParagraphStyle(doc, { name: 'Body', props: { fontSize: 12, fontFamily: 'EB Garamond' } });
    const b = addParagraphStyle(a.doc, { name: 'Lead', basedOn: a.id, props: { fontSize: 16 } });
    doc = b.doc;
    expect(resolveParagraphStyle(sheetOf(doc), b.id)).toEqual({ fontSize: 16, fontFamily: 'EB Garamond' });
  });

  it('editing a style updates every paragraph that uses it', () => {
    let { doc, story } = docWithStory('one\ntwo\nthree');
    const r = addParagraphStyle(doc, { name: 'H', props: { fontSize: 20 } });
    doc = r.doc;
    story = applyParagraphStyle(story, 0, 5, r.id); // paragraphs 0 and 1
    expect(styledParagraphs(story, sheetOf(doc)).map((p) => p.style.fontSize)).toEqual([20, 20, 10]);
    doc = updateTextStyle(doc, 'paragraph', r.id, { props: { fontSize: 30 } });
    expect(styledParagraphs(story, sheetOf(doc)).map((p) => p.style.fontSize)).toEqual([30, 30, 10]);
  });

  it('a change to a parent style flows down to styles based on it', () => {
    let { doc, story } = docWithStory('a');
    const base = addParagraphStyle(doc, { props: { fontFamily: 'Inter' } });
    const child = addParagraphStyle(base.doc, { basedOn: base.id, props: { fontSize: 18 } });
    doc = updateTextStyle(child.doc, 'paragraph', base.id, { props: { fontFamily: 'EB Garamond' } });
    story = applyParagraphStyle(story, 0, 0, child.id);
    expect(styleAt(story, sheetOf(doc), 0)).toMatchObject({ fontFamily: 'EB Garamond', fontSize: 18 });
  });

  it('refuses based-on cycles', () => {
    const { doc } = docWithStory('a');
    const a = addParagraphStyle(doc);
    const b = addParagraphStyle(a.doc, { basedOn: a.id });
    expect(wouldCycle(sheetOf(b.doc).paragraph, a.id, b.id)).toBe(true);
    expect(() => updateTextStyle(b.doc, 'paragraph', a.id, { basedOn: b.id })).toThrow();
  });

  it('character styles keep only character attributes and layer over the paragraph', () => {
    let { doc, story } = docWithStory('hello world');
    const cs = addCharacterStyle(doc, { name: 'Strong', props: { fontWeight: 700, align: 'center' } });
    doc = cs.doc;
    expect(resolveCharacterStyle(sheetOf(doc), cs.id)).toEqual({ fontWeight: 700 });
    story = applyCharStyle(story, 6, 11, cs.id);
    const runs = styledParagraphs(story, sheetOf(doc))[0].runs;
    expect(runs.map((r) => [r.start, r.end, r.style.fontWeight])).toEqual([[0, 6, 400], [6, 11, 700]]);
  });

  it('deleting a style keeps the look of text that used it', () => {
    let { doc, story } = docWithStory('abc');
    const r = addCharacterStyle(doc, { props: { italic: true } });
    story = applyCharStyle(story, 0, 2, r.id);
    doc = { ...r.doc, stories: { [story.id]: story } };
    expect(styleUsage(doc, 'character', r.id)).toBe(1);
    doc = deleteTextStyle(doc, 'character', r.id);
    expect(sheetOf(doc).character).toHaveLength(0);
    expect(styleAt(doc.stories[story.id], sheetOf(doc), 0).italic).toBe(true);
  });

  it('ships starter styles for layout documents', () => {
    const s = defaultLayoutStyles();
    expect(s.paragraph.map((p) => p.name)).toEqual(['Body', 'Heading 1', 'Heading 2', 'Caption']);
    const h1 = s.paragraph[1];
    expect(resolveParagraphStyle(s, h1.id).spaceAfter).toBe(10);
  });
});

describe('per-character formatting', () => {
  it('applies overrides to a range and splits runs', () => {
    const { doc, story } = docWithStory('abcdef');
    const s = applyCharProps(story, 2, 4, { fontSize: 20, figures: 'oldstyle', ligatures: false });
    const runs = styledParagraphs(s, sheetOf({ ...doc, textStyles: { paragraph: [], character: [], cell: [] } }))[0].runs;
    expect(runs.map((r) => [r.start, r.end, r.style.fontSize])).toEqual([[0, 2, 10], [2, 4, 20], [4, 6, 10]]);
    expect(runs[1].style.figures).toBe('oldstyle');
    expect(runs[1].style.ligatures).toBe(false);
  });

  it('ignores paragraph keys in character overrides', () => {
    const { story } = docWithStory('abc');
    const s = applyCharProps(story, 0, 1, { align: 'right', fontSize: 9 });
    expect(s.spans![0].props).toEqual({ fontSize: 9 });
  });

  it('reports a common or mixed value for a range', () => {
    const { story } = docWithStory('abcdef');
    const s = applyCharProps(story, 0, 3, { fontWeight: 700 });
    const sheet = { paragraph: [], character: [], cell: [] };
    expect(rangeValue(s, sheet, 0, 3, 'fontWeight')).toBe(700);
    expect(rangeValue(s, sheet, 0, 6, 'fontWeight')).toBeUndefined();
  });

  it('merges touching equal spans and drops plain ones', () => {
    expect(normaliseSpans([{ start: 0, end: 2, props: { italic: true } }, { start: 2, end: 4, props: { italic: true } }, { start: 4, end: 5 }]))
      .toEqual([{ start: 0, end: 4, props: { italic: true } }]);
    expect(mapSpanRange([], 1, 3, () => ({ props: { strike: true } }))).toEqual([{ start: 1, end: 3, props: { strike: true } }]);
  });
});

describe('paragraph attributes', () => {
  it('apply to every paragraph a range touches', () => {
    const { story } = docWithStory('a\nb\nc');
    const s = applyParaProps(story, 2, 3, { align: 'center', spaceAfter: 6 });
    const sheet = { paragraph: [], character: [], cell: [] };
    expect(styledParagraphs(s, sheet).map((p) => p.style.align)).toEqual(['left', 'center', 'left']);
    expect(paragraphRanges('a\nb\nc')).toEqual([{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }]);
  });
});

describe('formatting follows edits', () => {
  const sheet = { paragraph: [], character: [], cell: [] };
  it('shifts spans after an insertion before them', () => {
    let { story } = docWithStory('hello world');
    story = applyCharProps(story, 6, 11, { italic: true });
    story = replaceStoryText(story, 'oh hello world');
    expect(story.spans).toEqual([{ start: 9, end: 14, styleId: null, props: { italic: true } }]);
  });
  it('typing at the end of a formatted word continues the format', () => {
    let { story } = docWithStory('bold plain');
    story = applyCharProps(story, 0, 4, { fontWeight: 700 });
    story = replaceStoryText(story, 'boldest plain');
    expect(story.spans![0]).toMatchObject({ start: 0, end: 7 });
  });
  it('typing just before a formatted word takes the previous format', () => {
    let { story } = docWithStory('plain bold');
    story = applyCharProps(story, 6, 10, { fontWeight: 700 });
    story = replaceStoryText(story, 'plain xbold');
    expect(story.spans![0]).toMatchObject({ start: 7, end: 11 });
  });
  it('deleting formatted text removes its span', () => {
    let { story } = docWithStory('abcdef');
    story = applyCharProps(story, 2, 4, { italic: true });
    story = replaceStoryText(story, 'abef');
    expect(story.spans).toEqual([]);
  });
  it('splitting a paragraph copies its attributes; joining drops one', () => {
    let { story } = docWithStory('one two');
    story = applyParaProps(story, 0, 0, { align: 'right' });
    story = replaceStoryText(story, 'one\ntwo');
    expect(styledParagraphs(story, sheet).map((p) => p.style.align)).toEqual(['right', 'right']);
    story = replaceStoryText(story, 'onetwo');
    expect(story.paras).toHaveLength(1);
  });
  it('a new paragraph after a heading gets the heading\'s next style', () => {
    const { doc } = docWithStory('x');
    const sheetFull = defaultLayoutStyles();
    const h1 = sheetFull.paragraph[1];
    let story = createStory('Title', {});
    story = applyParagraphStyle(story, 0, 0, h1.id);
    story = replaceStoryText(story, 'Title\n', sheetFull);
    expect(story.paras![1]?.styleId).toBe(h1.nextStyle);
    void doc;
  });
  it('slices formatting with the text', () => {
    let { story } = docWithStory('ab\ncd');
    story = applyCharProps(story, 1, 4, { italic: true });
    story = applyParaProps(story, 3, 3, { align: 'center' });
    const s = sliceStory(story, 3, 5);
    expect(s.text).toBe('cd');
    expect(s.spans).toEqual([{ start: 0, end: 1, styleId: null, props: { italic: true } }]);
    expect(s.paras![0]?.props?.align).toBe('center');
  });
});

describe('fields', () => {
  it('shows the page number in context and # without one', () => {
    expect(fieldText(FIELD_PAGE, { page: 'iv', pageCount: '9', section: 'Intro' })).toBe('iv');
    expect(fieldText(FIELD_PAGE, null)).toBe('#');
  });
});
