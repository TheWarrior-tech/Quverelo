/** Every code example in docs/SCRIPTING.md runs, and the documented API matches the prelude. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument, createStory, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { runScript } from '../../src/core/scripting/runner';
import { SCRIPTING_DTS } from '../../src/core/scripting/prelude';

const md = readFileSync('docs/SCRIPTING.md', 'utf8');
const examples = [...md.slice(md.indexOf('## Examples')).matchAll(/### (.+)\n\n```(js|ts)\n([\s\S]*?)```/g)].map((m) => ({ title: m[1], language: m[2] as 'js' | 'ts', source: m[3] }));

function doc() {
  let d = createDocument({ title: 'Worksheet', pages: 2, settings: { width: 794, height: 1123 } });
  const story = createStory('Pick a colour you like', {});
  const tf = make.textframe({ storyId: story.id, x: 400, y: 500 });
  story.chain = [tf.id];
  d = { ...d, stories: { [story.id]: story } };
  const a = make.rect({ name: 'A', x: 300, y: 100 });
  const b = make.rect({ name: 'B', x: 100, y: 100 });
  d = addNodes(d, d.pages[0].id, [a, b, make.text({ text: 'The colour wheel', x: 400, y: 200 }), make.text({ text: '  ', x: 400, y: 260 }), tf]);
  return { d, sel: [a.id, b.id] };
}

describe('docs/SCRIPTING.md', () => {
  it('has the examples', () => expect(examples.length).toBeGreaterThanOrEqual(8));

  for (const ex of examples) {
    it(`example runs: ${ex.title}`, async () => {
      const { d, sel } = doc();
      const r = await runScript(ex.source, d, sel, { language: ex.language });
      expect(r.error).toBeNull();
      expect(r.ok).toBe(true);
    });
  }

  it('documents the same declarations the app ships', () => {
    const block = /## Type declarations[\s\S]*?```ts\n([\s\S]*?)```/.exec(md)![1];
    expect(block.trim()).toBe(SCRIPTING_DTS.trim());
  });

  it('documents every Node, Page and document member', () => {
    for (const m of ['addRect', 'addEllipse', 'addPolygon', 'addStar', 'addText', 'addTextFrame', 'addPath', 'moveBy', 'duplicate', 'ungroup', 'remove', 'info()', 'addPage', 'addSwatch', 'group(nodes)', 'toMm', 'color.hsl', 'selection']) {
      expect(md, m).toContain(m);
    }
  });
});
