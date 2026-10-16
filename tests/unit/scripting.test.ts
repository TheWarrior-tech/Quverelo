import { describe, expect, it } from 'vitest';
import { createDocument, createStory, make } from '../../src/core/document';
import { addNodes } from '../../src/core/commands';
import { ScriptHost } from '../../src/core/scripting/host';
import { runScript, toJavaScript } from '../../src/core/scripting/runner';
import { EXAMPLE_SCRIPTS } from '../../src/core/scripting/examples';
import type { RectNode, TextNode, TextFrameNode } from '../../src/core/types';

function sampleDoc() {
  let doc = createDocument({ title: 'Poster', settings: { width: 800, height: 600 } });
  const a = make.rect({ name: 'A', x: 300, y: 100 });
  const b = make.rect({ name: 'B', x: 100, y: 100 });
  const t = make.text({ name: 'Headline', text: 'The colour of sound', x: 400, y: 300 });
  const story = createStory('A colour story', {});
  const tf = make.textframe({ storyId: story.id, x: 400, y: 500 });
  story.chain = [tf.id];
  doc = { ...doc, stories: { [story.id]: story } };
  doc = addNodes(doc, doc.pages[0].id, [a, b, t, tf]);
  return { doc, a, b, t, tf };
}

describe('Script host (JSON operations)', () => {
  it('reads and edits nodes with validation', () => {
    const { doc, a } = sampleDoc();
    const h = new ScriptHost(doc);
    expect(h.call('doc.info', [])).toMatchObject({ title: 'Poster', width: 800, pageCount: 1 });
    h.call('node.set', [a.id, { fill: '#ff0000', x: 10, opacity: 0.5, radius: 4 }]);
    const info = h.call('node.get', [a.id]) as { fill: string; x: number; opacity: number; radius: number };
    expect(info).toMatchObject({ fill: '#ff0000', x: 10, opacity: 0.5, radius: 4 });
    expect(() => h.call('node.set', [a.id, { opacity: 3 }])).toThrow(/between 0 and 1/);
    expect(() => h.call('node.set', [a.id, { fill: 'url(http://x)' }])).toThrow(/colour/);
    expect(() => h.call('node.set', [a.id, { evil: 1 }])).toThrow(/Unknown property/);
    expect(() => h.call('node.get', ['nope'])).toThrow(/No object/);
    // the original document is untouched until committed
    expect((doc.pages[0].nodes[0] as RectNode).x).toBe(300);
  });

  it('enforces the creation limit', () => {
    const h = new ScriptHost(createDocument(), [], { maxCreated: 2, maxString: 100 });
    h.call('create', [0, 'rect', {}]);
    h.call('create', [0, 'ellipse', {}]);
    expect(() => h.call('create', [0, 'star', {}])).toThrow(/at most 2/);
  });
});

describe('Script runner (QuickJS sandbox)', () => {
  it('runs JavaScript against the document API', async () => {
    const { doc } = sampleDoc();
    const r = await runScript(`
      const r = document.page.addRect({ x: 50, y: 60, w: 20, h: 30, fill: '#00ff00', name: 'New' });
      r.rotation = 45;
      document.title = 'Scripted';
      log('made', r.type);
      return document.page.nodes.length;
    `, doc);
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.value).toBe(5);
    expect(r.logs).toEqual(['made rect']);
    expect(r.doc.title).toBe('Scripted');
    const n = r.doc.pages[0].nodes.at(-1) as RectNode;
    expect(n).toMatchObject({ type: 'rect', name: 'New', x: 50, y: 60, w: 20, h: 30, rotation: 45, fill: { type: 'solid', color: '#00ff00' } });
  });

  it('runs TypeScript and works with the selection, find and text', async () => {
    const { doc, a, b, t, tf } = sampleDoc();
    const r = await runScript(`
      const items: Node[] = selection.nodes.sort((p, q) => p.bounds.x - q.bounds.x);
      items.forEach((n, i) => (n.name = 'Item ' + (i + 1)));
      for (const n of document.find({ text: 'colour' })) n.text = n.text.replace('colour', 'color');
      selection.set([items[0]]);
    `, doc, [a.id, b.id], { language: 'ts' });
    expect(r.error).toBeNull();
    const byId = (id: string) => r.doc.pages[0].nodes.find((n) => n.id === id)!;
    expect(byId(b.id).name).toBe('Item 1');
    expect(byId(a.id).name).toBe('Item 2');
    expect((byId(t.id) as TextNode).text).toBe('The color of sound');
    expect(r.doc.stories[(byId(tf.id) as TextFrameNode).storyId].text).toBe('A color story');
    expect(r.selection).toEqual([b.id]);
  });

  it('has no access to the host environment or the network', async () => {
    const r = await runScript(`
      return [typeof fetch, typeof XMLHttpRequest, typeof require, typeof process, typeof window, typeof __host, typeof WebSocket, typeof importScripts];
    `, createDocument());
    expect(r.error).toBeNull();
    expect(r.value).toEqual(Array(8).fill('undefined'));
  });

  it('stops runaway scripts and applies nothing', async () => {
    const doc = createDocument();
    const r = await runScript(`document.page.addRect({}); while (true) {}`, doc, [], { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/longer than/);
    expect(r.doc).toBe(doc);
    expect(r.changed).toBe(false);
  });

  it('stops scripts that use too much memory', async () => {
    const r = await runScript(`let s = 'x'; const keep = []; for (;;) { s += s; keep.push(s); }`, createDocument(), [], { memoryBytes: 8 * 1024 * 1024, timeoutMs: 5000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/memory|InternalError|RangeError/i);
  });

  it('reports errors with their line number', async () => {
    const r = await runScript(`const x = 1;\nnull.boom();`, createDocument());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TypeError/);
    expect(r.error).toMatch(/line 2/);
    const bad = await runScript(`document.page.addRect({ opacity: 9 })`, createDocument());
    expect(bad.error).toMatch(/opacity must be between 0 and 1/);
  });

  it('strips TypeScript types', () => {
    expect(toJavaScript('const n: number = 1; interface A { b: string }', 'ts')).not.toMatch(/number|interface/);
  });

  it('runs every bundled example without errors', async () => {
    const { doc, a, b } = sampleDoc();
    for (const ex of EXAMPLE_SCRIPTS) {
      const r = await runScript(ex.source, doc, [a.id, b.id], { language: ex.language });
      expect(r.error, ex.name).toBeNull();
      expect(r.changed, ex.name).toBe(true);
    }
  });
});
