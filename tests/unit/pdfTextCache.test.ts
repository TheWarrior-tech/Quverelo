import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { withWordCache } from '../../src/core/pdfTextCache';

const LINES = [
  'The quick brown fox jumps over the lazy dog.',
  'office affine fjord — “quoted” text, 1/2 and 3×4 → arrows',
  '  leading and  double  spaces ',
  'NoSpacesAtAll',
  '',
  'Quvrelo lays out long documents offline. Quvrelo lays out long documents offline.',
];

async function fonts(file: string, subset = false) {
  // without subsetting the hex is the font's own glyph ids (a subset numbers glyphs in first-use order)
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = readFileSync(`node_modules/@fontsource/${file}`);
  return [await pdf.embedFont(bytes, { subset }), withWordCache(await pdf.embedFont(bytes, { subset }))];
}

describe('PDF text encoding with a per-word cache', () => {
  for (const file of ['inter/files/inter-latin-400-normal.woff', 'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff']) {
    it(`gives the same glyphs as full-line shaping (${file.split('/')[0]})`, async () => {
      const [plain, cached] = await fonts(file);
      for (const t of LINES) expect(cached.encodeText(t).toString(), t).toBe(plain.encodeText(t).toString());
      // second pass is served from the cache and still identical
      for (const t of LINES) expect(cached.encodeText(t).toString()).toBe(plain.encodeText(t).toString());
    });
  }

  it('is much faster on repetitive body text', async () => {
    const [plain, cached] = await fonts('inter/files/inter-latin-400-normal.woff');
    const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore'.split(' ');
    const lines = Array.from({ length: 400 }, (_, i) => Array.from({ length: 12 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' '));
    let t = performance.now();
    for (const l of lines) plain.encodeText(l);
    const slow = performance.now() - t;
    t = performance.now();
    for (const l of lines) cached.encodeText(l);
    const fast = performance.now() - t;
    expect(fast).toBeLessThan(slow / 3);
  });
});
