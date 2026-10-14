import { describe, expect, it } from 'vitest';
import { flowStory, monoMeasure, nextLine } from '../../src/core/textflow';
import { defaultTextStyle } from '../../src/core/document';

const style = defaultTextStyle({ fontSize: 10, lineHeight: 1 }); // mono: 5px per char, 10px lines
const m = monoMeasure(0.5);

describe('text flow', () => {
  it('wraps on word boundaries', () => {
    const l = nextLine('hello brave new world', 0, 60, style, m); // 12 chars
    expect('hello brave new world'.slice(l.start, l.end)).toBe('hello brave');
  });
  it('breaks very long words', () => {
    const l = nextLine('abcdefghijklmnop', 0, 25, style, m);
    expect(l.end - l.start).toBe(5);
  });
  it('honours hard line breaks', () => {
    const r = flowStory('one\ntwo\n\nthree', style, [{ id: 'a', w: 200, h: 100, padding: 0, columns: 1, columnGap: 0 }], m);
    expect(r.frames.a.lines.map((l) => l.text)).toEqual(['one', 'two', '', 'three']);
    expect(r.overflow).toBe(false);
  });
  it('flows across frames and columns and reports overflow', () => {
    const text = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const frames = [
      { id: 'a', w: 50, h: 30, padding: 0, columns: 1, columnGap: 0 },
      { id: 'b', w: 110, h: 20, padding: 0, columns: 2, columnGap: 10 },
    ];
    const r = flowStory(text, style, frames, m);
    expect(r.frames.a.lines).toHaveLength(3);
    expect(r.frames.b.lines).toHaveLength(4);
    expect(r.frames.b.lines[2].x).toBe(60);
    expect(r.overflow).toBe(true);
    // contiguous ranges
    expect(r.frames.b.start).toBe(r.frames.a.end);
  });
  it('aligns centre and right', () => {
    const c = flowStory('ab', { ...style, align: 'center' }, [{ id: 'a', w: 100, h: 10, padding: 0, columns: 1, columnGap: 0 }], m);
    expect(c.frames.a.lines[0].x).toBe(45);
    const r = flowStory('ab', { ...style, align: 'right' }, [{ id: 'a', w: 100, h: 10, padding: 0, columns: 1, columnGap: 0 }], m);
    expect(r.frames.a.lines[0].x).toBe(90);
  });
});
