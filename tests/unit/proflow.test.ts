/**
 * Pro paragraph composition (Layout): hyphenation (Liang / TeX en-GB and
 * en-US patterns), tab stops with alignment and leaders, keep with next,
 * keep lines together and widow / orphan control.
 */
import { describe, expect, it } from 'vitest';
import { createStory } from '../../src/core/document';
import { hyphenateWord, hyphenPoints } from '../../src/core/hyphenation';
import { caretX, DEFAULT_TAB_INTERVAL, flowRichStory, indexAtX, monoMeasure, type FlowFrame } from '../../src/core/textflow';
import { applyParaProps } from '../../src/core/typography';
import type { Story } from '../../src/core/types';

const m = monoMeasure(0.5);
const sheet = { paragraph: [], character: [], cell: [] };
const frame = (o: Partial<FlowFrame> = {}): FlowFrame => ({ id: 'f', w: 200, h: 200, padding: 0, columns: 1, columnGap: 0, ...o });
const base = { fontSize: 10, lineHeight: 1 }; // mono: 5 px per char, 10 px lines

describe('hyphenation patterns', () => {
  it('uses British and American patterns', () => {
    expect(hyphenateWord('hyphenation', 'en-GB')).toBe('hy-phen-a-tion');
    expect(hyphenateWord('typography', 'en-GB')).toBe('ty-po-graphy');
    expect(hyphenateWord('typography', 'en-US')).toBe('ty-pog-ra-phy');
    expect(hyphenateWord('organisation', 'en-GB')).toBe('or-gan-isa-tion');
  });
  it('keeps 2 letters before and 3 after a break, skips short words, numbers and punctuation', () => {
    for (const p of hyphenPoints('extraordinary', 'en-US')) {
      expect(p).toBeGreaterThanOrEqual(2);
      expect('extraordinary'.length - p).toBeGreaterThanOrEqual(3);
    }
    expect(hyphenPoints('table', 'en-GB')).toEqual([]);
    expect(hyphenPoints('10th')).toEqual([]);
    expect(hyphenateWord('(publishing,')).toBe('(pub-lish-ing,');
  });
  it('honours soft hyphens typed into the text', () => {
    expect(hyphenPoints('Quv\u00ADrelo')).toEqual([4]);
  });
});

describe('hyphenated flow', () => {
  const text = 'the hyphenation engine';
  it('breaks a word at a pattern point and draws a hyphen when the paragraph asks for it', () => {
    let s = createStory(text, base);
    // 60 px = 12 chars: "the hyphena-" just fits (hy-phen-a-tion), "the hyphenation" does not
    const plain = flowRichStory(s, sheet, [frame({ w: 60 })], m).frames.f.lines;
    expect(plain.map((l) => l.text)).toEqual(['the', 'hyphenation', 'engine']);
    s = applyParaProps(s, 0, 0, { hyphenate: true });
    const lines = flowRichStory(s, sheet, [frame({ w: 60 })], m).frames.f.lines;
    expect(lines.map((l) => l.text)).toEqual(['the hyphena-', 'tion engine']);
    const hy = lines[0].runs![lines[0].runs!.length - 1];
    expect(hy).toMatchObject({ text: '-', hyphen: true, start: 11, end: 11, x: 55 });
    // the story is untouched and the next line starts right after the break
    expect(lines[0].end).toBe(11);
    expect(lines[1].start).toBe(11);
    // the caret at the break sits before the hyphen; clicks on the hyphen go to the break
    expect(caretX(lines[0], 11, m)).toBe(55);
    expect(indexAtX(lines[0], 58, m)).toBe(11);
  });
  it('American patterns give American breaks', () => {
    let s = createStory('typography', base);
    s = applyParaProps(s, 0, 0, { hyphenate: true, language: 'en-US' });
    // 40 px = 8 chars: ty-pog-ra-phy (US) vs ty-po-graphy (UK)
    expect(flowRichStory(s, sheet, [frame({ w: 40 })], m).frames.f.lines[0].text).toBe('typogra-');
    s = applyParaProps(s, 0, 0, { language: 'en-GB' });
    expect(flowRichStory(s, sheet, [frame({ w: 40 })], m).frames.f.lines[0].text).toBe('typo-');
  });
});

describe('tab stops', () => {
  const runsOf = (s: Story, w = 200) => flowRichStory(s, sheet, [frame({ w })], m).frames.f.lines[0].runs!;
  it('default stops every half inch', () => {
    const r = runsOf(createStory('ab\tc', base));
    expect(r.map((x) => [x.text, x.x])).toEqual([['ab', 0], ['', 10], ['c', DEFAULT_TAB_INTERVAL]]);
    expect(r[1].tab).toBe(true);
    expect(r[1].width).toBe(DEFAULT_TAB_INTERVAL - 10);
  });
  it('left, right, centre and decimal stops', () => {
    let s = createStory('a\tb\tcc\tdd\t12.50', base);
    s = applyParaProps(s, 0, 0, { tabStops: [{ pos: 30, align: 'left' }, { pos: 80, align: 'right' }, { pos: 120, align: 'center' }, { pos: 170, align: 'decimal' }] });
    const r = runsOf(s, 300).filter((x) => !x.tab);
    expect(r.map((x) => [x.text, x.x])).toEqual([
      ['a', 0],
      ['b', 30], // left: starts at the stop
      ['cc', 70], // right: ends at 80
      ['dd', 115], // centre: middle at 120
      ['12.50', 160], // decimal: the point at 170
    ]);
  });
  it('leaders fill the tab space; the caret treats the tab as one character', () => {
    let s = createStory('Intro\t7', base);
    s = applyParaProps(s, 0, 0, { tabStops: [{ pos: 100, align: 'right', leader: '.' }] });
    const line = flowRichStory(s, sheet, [frame()], m).frames.f.lines[0];
    const tab = line.runs!.find((x) => x.tab)!;
    expect(tab.x).toBe(25);
    expect(tab.width).toBe(70);
    expect(tab.text).toBe('.'.repeat(14));
    expect(caretX(line, 6, m)).toBe(95);
    expect(indexAtX(line, 40, m)).toBe(5);
  });
  it('a line may break before a tab, which then starts the next line', () => {
    let s = createStory('aaaaa bbbbb\tccc', base);
    s = applyParaProps(s, 0, 0, { tabStops: [{ pos: 20, align: 'left' }] });
    const lines = flowRichStory(s, sheet, [frame({ w: 60 })], m).frames.f.lines;
    // at x 55 the next stop (default, 68) is past the edge: break before the tab
    expect(lines.map((l) => l.text)).toEqual(['aaaaa bbbbb', 'ccc']);
    const r = lines[1].runs!;
    expect(r[0].tab).toBe(true);
    expect(r[1].x).toBe(20); // on the new line the tab reaches the 20px stop
    expect(lines[1].start).toBe(11);
  });
});

describe('keep options and widow / orphan control', () => {
  // frame 50 px tall = 5 lines of 10 px; lines hold 4 chars at w = 20
  const two = (f: Partial<FlowFrame> = {}) => [frame({ id: 'a', w: 20, h: 50, ...f }), frame({ id: 'b', w: 20, h: 200, ...f })];
  const texts = (s: Story) => {
    const r = flowRichStory(s, sheet, two(), m).frames;
    return { a: r.a.lines.map((l) => l.text), b: r.b.lines.map((l) => l.text) };
  };
  it('keep with next moves a heading to the next frame with its paragraph', () => {
    // 4 one-line paragraphs, then a heading on line 5 and its body on line 6
    let s = createStory('a\nb\nc\nd\nHead\nbody', base);
    expect(texts(s).a).toEqual(['a', 'b', 'c', 'd', 'Head']);
    s = applyParaProps(s, 9, 9, { keepWithNext: true });
    const t = texts(s);
    expect(t.a).toEqual(['a', 'b', 'c', 'd']);
    expect(t.b).toEqual(['Head', 'body']);
  });
  it('chained keep with next (two headings) moves both', () => {
    let s = createStory('a\nb\nc\nH1\nH2\nbody', base);
    s = applyParaProps(s, 6, 9, { keepWithNext: true });
    const t = texts(s);
    expect(t.a).toEqual(['a', 'b', 'c']);
    expect(t.b).toEqual(['H1', 'H2', 'body']);
  });
  it('keep lines together moves the whole paragraph', () => {
    let s = createStory('a\nb\nc\naaaa bbbb cccc', base);
    expect(texts(s)).toEqual({ a: ['a', 'b', 'c', 'aaaa', 'bbbb'], b: ['cccc'] });
    s = applyParaProps(s, 6, 6, { keepTogether: true });
    expect(texts(s)).toEqual({ a: ['a', 'b', 'c'], b: ['aaaa', 'bbbb', 'cccc'] });
  });
  it('orphans: a paragraph never leaves fewer lines than asked at the foot of a frame', () => {
    let s = createStory('a\nb\nc\nd\naaaa bbbb cccc', base);
    expect(texts(s).a).toEqual(['a', 'b', 'c', 'd', 'aaaa']);
    s = applyParaProps(s, 8, 8, { orphans: 2 });
    expect(texts(s)).toEqual({ a: ['a', 'b', 'c', 'd'], b: ['aaaa', 'bbbb', 'cccc'] });
  });
  it('widows: a broken paragraph carries at least that many lines to the next frame', () => {
    let s = createStory('a\nb\naaaa bbbb cccc dddd', base);
    expect(texts(s)).toEqual({ a: ['a', 'b', 'aaaa', 'bbbb', 'cccc'], b: ['dddd'] });
    s = applyParaProps(s, 4, 4, { widows: 2 });
    expect(texts(s)).toEqual({ a: ['a', 'b', 'aaaa', 'bbbb'], b: ['cccc', 'dddd'] });
  });
  it('widows and orphans together move the whole paragraph when it cannot split', () => {
    let s = createStory('a\nb\nc\naaaa bbbb cccc', base);
    s = applyParaProps(s, 6, 6, { widows: 2, orphans: 2 });
    expect(texts(s)).toEqual({ a: ['a', 'b', 'c'], b: ['aaaa', 'bbbb', 'cccc'] });
  });
  it('a paragraph taller than the frame still breaks (the rules give way)', () => {
    let s = createStory('aaaa bbbb cccc dddd eeee ffff gggg', base);
    s = applyParaProps(s, 0, 0, { keepTogether: true });
    expect(texts(s).a).toHaveLength(5);
  });
  it('applies between columns as well as frames', () => {
    let s = createStory('a\nb\nc\nd\nHead\nbody', base);
    s = applyParaProps(s, 9, 9, { keepWithNext: true });
    const r = flowRichStory(s, sheet, [frame({ id: 'a', w: 50, h: 50, columns: 2, columnGap: 10 })], m).frames.a.lines;
    expect(r.filter((l) => l.x >= 30).map((l) => l.text)).toEqual(['Head', 'body']);
  });
});

describe('style interning', () => {
  it('tells apart styles that differ only in nested values (fills, tab stops)', async () => {
    const { internStyle, stableKey } = await import('../../src/core/typography');
    const a = { ...createStory('', base).style, fill: { type: 'solid' as const, color: '#ff0000' } };
    const b = { ...a, fill: { type: 'solid' as const, color: '#0000ff' } };
    expect(internStyle(a)).not.toBe(internStyle(b));
    expect(internStyle({ ...a })).toBe(internStyle(a));
    const t1 = { ...a, tabStops: [{ pos: 10, align: 'left' as const }] };
    const t2 = { ...a, tabStops: [{ pos: 10, align: 'right' as const, leader: '.' }] };
    expect(internStyle(t1)).not.toBe(internStyle(t2));
    expect(stableKey({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  });
});
