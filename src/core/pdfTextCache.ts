/**
 * Faster text encoding for embedded fonts in PDF export.
 *
 * pdf-lib's CustomFontEmbedder.encodeText runs fontkit's full OpenType shaping
 * (GSUB/GPOS lookups) on every call; for body text that was ~85 % of a 50-page
 * export. Glyph choice only depends on a word and its neighbours inside the
 * word (ligatures, contextual alternates), so each line is shaped word by word
 * and words are cached per font. Words repeat a lot in real text, so most of a
 * long document is a cache hit. Output glyph ids are identical except for
 * contextual rules that look across a space, which body fonts don't use for
 * Latin text.
 */
import { PDFHexString, type PDFFont } from 'pdf-lib';

const MAX_WORDS = 20000;

export function withWordCache(font: PDFFont): PDFFont {
  const original = font.encodeText.bind(font);
  const cache = new Map<string, string>();
  const hexOf = (s: string): string => {
    let h = cache.get(s);
    if (h === undefined) {
      const enc = original(s).toString(); // "<0012003a…>"
      h = enc.slice(1, -1);
      if (cache.size >= MAX_WORDS) cache.clear();
      cache.set(s, h);
    }
    return h;
  };
  const encode = (text: string) => {
    if (!text.includes(' ')) return original(text);
    const parts = text.split(' ');
    const space = hexOf(' ');
    let hex = '';
    for (let i = 0; i < parts.length; i++) {
      if (i) hex += space;
      if (parts[i]) hex += hexOf(parts[i]);
    }
    return PDFHexString.of(hex);
  };
  font.encodeText = encode;
  return font;
}
