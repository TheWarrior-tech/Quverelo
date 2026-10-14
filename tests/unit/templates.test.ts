import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../../src/core/templates';
import { allContainers, findNode, walk } from '../../src/core/document';
import { pageToSvg } from '../../src/core/svg';
import { migrateDocument } from '../../src/core/migrate';

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
