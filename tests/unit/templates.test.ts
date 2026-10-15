import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/core/templates';
import { allContainers, findNode, walk } from '../../src/core/document';
import { pageToSvg } from '../../src/core/svg';
import { migrateDocument } from '../../src/core/migrate';
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { flowStory, type MeasureFn } from '../../src/core/textflow';
import { bundledFaceFor } from '../../src/core/pdfFonts';
import type { SceneNode, TextStyle } from '../../src/core/types';

describe('templates', () => {
  it('has a classroom pack', () => {
    expect(TEMPLATES.filter((t) => t.category === 'Classroom').length).toBeGreaterThanOrEqual(8);
  });
  for (const t of TEMPLATES) {
    it(`${t.name} builds a valid document`, () => {
      const d = t.build();
      expect(() => migrateDocument(JSON.parse(JSON.stringify(d)))).not.toThrow();
      expect(d.settings.width).toBeGreaterThan(0);
      const ids = new Set<string>();
      for (const c of allContainers(d)) walk(c.nodes, (n) => {
        expect(ids.has(n.id)).toBe(false);
        ids.add(n.id);
        if (n.type === 'textframe') expect(d.stories[n.storyId]?.chain).toContain(n.id);
      });
      for (const s of Object.values(d.stories)) for (const f of s.chain) expect(findNode(d, f)).not.toBeNull();
      for (const p of d.pages) expect(pageToSvg(d, p)).toContain('<svg');
    });
  }
});

/**
 * Critique 3 N8: no bundled template may open with an overflowing text frame
 * (the red + port). Text is laid out with the real metrics of the bundled face
 * the canvas draws it with (the same @fontsource files the app and the PDF use);
 * a family that isn't bundled is measured with Inter plus a 6 % allowance,
 * since a system face can run wider.
 */
const fonts = new Map<string, ReturnType<typeof fontkit.create>>();
function faceFor(style: TextStyle) {
  const b = bundledFaceFor(style) ?? bundledFaceFor({ ...style, fontFamily: 'Inter' })!;
  const file = path.join(process.cwd(), 'node_modules/@fontsource', b.pkg, b.file);
  let f = fonts.get(file);
  if (!f) {
    f = fontkit.create(fs.readFileSync(file)) as ReturnType<typeof fontkit.create>;
    fonts.set(file, f);
  }
  return { font: f as any, slack: bundledFaceFor(style) ? 1 : 1.06 };
}
const measure: MeasureFn = (text, style) => {
  if (!text) return 0;
  const { font, slack } = faceFor(style);
  const run = font.layout(text);
  return (run.advanceWidth / font.unitsPerEm) * style.fontSize * slack;
};

type TextFrame = Extract<SceneNode, { type: 'textframe' }>;

describe('bundled templates have no overflowing text (critique 3 N8)', () => {
  for (const t of TEMPLATES) {
    it(`${t.name}: every story fits its frames`, () => {
      const d = t.build();
      const frames = new Map<string, TextFrame>();
      for (const c of allContainers(d)) walk(c.nodes, (n) => { if (n.type === 'textframe') frames.set(n.id, n as TextFrame); });
      const over: string[] = [];
      for (const [sid, s] of Object.entries(d.stories)) {
        const chain = s.chain.map((id) => frames.get(id)).filter(Boolean) as TextFrame[];
        if (!chain.length) continue;
        const r = flowStory(s.text, s.style, chain as any, measure);
        if (r.overflow) over.push(`${JSON.stringify(s.text.slice(0, 40))} (story ${sid}) overflows at ${r.overflowAt}/${s.text.length}`);
      }
      expect(over).toEqual([]);
    });
  }
});
