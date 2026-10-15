import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/core/templates';
import { allContainers, findNode, walk } from '../../src/core/document';
import { pageToSvg } from '../../src/core/svg';
import { migrateDocument } from '../../src/core/migrate';
import { flowStory, type MeasureFn } from '../../src/core/textflow';

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

  // A bundled template must open without an overflow port. Inter-like metrics: a pessimistic
  // 0.58 em per character (0.62 for bold) so a pass here also passes with the real font.
  const measure: MeasureFn = (text, st) => text.length * st.fontSize * (st.fontWeight >= 600 ? 0.62 : 0.58);
  for (const t of TEMPLATES) {
    it(`${t.name} has no overflowing text frames`, () => {
      const d = t.build();
      const over: string[] = [];
      for (const [sid, story] of Object.entries(d.stories)) {
        const frames = story.chain.map((fid) => findNode(d, fid)?.node).filter((n): n is NonNullable<typeof n> & { type: 'textframe' } => !!n && n.type === 'textframe');
        const r = flowStory(story.text, story.style, frames.map((f) => ({ id: f.id, w: f.w, h: f.h, padding: f.padding, columns: f.columns, columnGap: f.columnGap })), measure);
        if (r.overflow) over.push(`${sid}: ${JSON.stringify(story.text.slice(0, 40))}`);
      }
      expect(over).toEqual([]);
    });
  }
});
