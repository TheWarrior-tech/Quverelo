import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, fontSections } from '../../src/renderer/ui/fontList';

describe('font picker sections', () => {
  it('lists Recent first, then Bundled, System and Installed, each font once', () => {
    const s = fontSections('', ['Caveat', 'Georgia'], ['Zilla Slab', 'Caveat']);
    expect(s.map((x) => x.title)).toEqual(['Recent', 'Bundled', 'System', 'Installed']);
    expect(s[0].fonts).toEqual(['Caveat', 'Georgia']);
    expect(s[1].fonts).not.toContain('Caveat');
    expect(s[2].fonts).not.toContain('Georgia');
    expect(s[3].fonts).toEqual(['Zilla Slab']);
    const all = s.flatMap((x) => x.fonts);
    expect(new Set(all).size).toBe(all.length);
  });

  it('filters case-insensitively and hides Recent while searching', () => {
    const s = fontSections('SLAB', ['Roboto Slab'], ['Zilla Slab']);
    expect(s.map((x) => x.title)).toEqual(['Bundled', 'Installed']);
    expect(s[0].fonts).toEqual(['Roboto Slab']);
    expect(s[1].fonts).toEqual(['Zilla Slab']);
  });

  it('drops empty sections and returns nothing for no match', () => {
    expect(fontSections('no such typeface', [], [])).toEqual([]);
    expect(fontSections('', [], []).map((x) => x.title)).toEqual(['Bundled', 'System']);
    expect(fontSections('', [], [])[0].fonts).toEqual(BUNDLED_FONTS);
  });
});
