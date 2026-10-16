import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { png, sampleIdml } from '../fixtures/interop';
import { fontStyleToCss, imageSize, importIdml, PX_PER_PT } from '../../src/core/interop/idml';
import { parseXml, findAll, textOf } from '../../src/core/interop/xml';
import type { EllipseNode, ImageFrameNode, PathNode, RectNode, TextFrameNode } from '../../src/core/types';

describe('XML reader', () => {
  it('parses elements, attributes, entities, CDATA and comments', () => {
    const x = parseXml('<?xml version="1.0"?><!-- c --><a k="1 &amp; 2"><b>x &lt; y</b><c/><![CDATA[<raw>]]></a>');
    const a = findAll(x, 'a')[0];
    expect(a.attrs.k).toBe('1 & 2');
    expect(textOf(findAll(a, 'b')[0])).toBe('x < y');
    expect(findAll(a, 'c')).toHaveLength(1);
    expect(a.children.at(-1)).toBe('<raw>');
  });
});

describe('IDML import', () => {
  it('reads image headers and font styles', () => {
    expect(imageSize(new Uint8Array(png))).toMatchObject({ mime: 'image/png' });
    expect(fontStyleToCss('Semibold Italic')).toEqual({ weight: 600, italic: true });
    expect(fontStyleToCss(undefined)).toEqual({ weight: 400, italic: false });
  });

  it('imports pages, margins, masters, threaded stories, styles, shapes, colours and images', async () => {
    const r = await importIdml(await sampleIdml(), 'Newsletter');
    const doc = r.doc;
    expect(doc.studio).toBe('layout');
    expect(doc.settings.width).toBeCloseTo(612 * PX_PER_PT);
    expect(doc.settings.height).toBeCloseTo(792 * PX_PER_PT);
    expect(doc.settings.margins.top).toBeCloseTo(36 * PX_PER_PT);
    expect(doc.settings.columns).toBe(2);
    expect(doc.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2']);

    // master
    expect(doc.masters).toHaveLength(1);
    expect(doc.masters[0].name).toBe('A-Master');
    expect(doc.pages.every((p) => p.masterId === doc.masters[0].id)).toBe(true);
    const footer = doc.masters[0].nodes[0] as RectNode;
    expect(footer.type).toBe('rect');
    expect(footer.y).toBeCloseTo((396 + 378) * PX_PER_PT); // spread y 360..396 -> page y 756..792

    // swatches
    expect(doc.swatches.map((s) => s.name)).toEqual(expect.arrayContaining(['Brand Red', 'Cyan']));

    // threaded text
    const p1 = doc.pages[0].nodes;
    const tf1 = p1.find((n) => n.type === 'textframe') as TextFrameNode;
    const tf2 = doc.pages[1].nodes.find((n) => n.type === 'textframe') as TextFrameNode;
    expect(tf1.storyId).toBe(tf2.storyId);
    const story = doc.stories[tf1.storyId];
    expect(story.chain).toEqual([tf1.id, tf2.id]);
    expect(story.text).toBe('Fish & chips\nSecond paragraph');
    expect(tf1.columns).toBe(2);
    expect(tf1.columnGap).toBeCloseTo(10 * PX_PER_PT);
    expect(tf1.padding).toBeCloseTo(4 * PX_PER_PT);
    expect(tf1.w).toBeCloseTo(264 * PX_PER_PT);
    expect(tf1.x).toBeCloseTo(168 * PX_PER_PT);
    expect(tf1.y).toBeCloseTo((396 - 280) * PX_PER_PT);

    // resolved style: Body BasedOn Base
    expect(story.style.fontFamily.startsWith('Minion Pro')).toBe(true);
    expect(story.style.fontSize).toBeCloseTo(10 * PX_PER_PT);
    expect(story.style.fontWeight).toBe(700);
    expect(story.style.italic).toBe(true);
    expect(story.style.align).toBe('center');
    expect(story.style.letterSpacing).toBe(20);
    expect(story.style.lineHeight).toBeCloseTo(1.4);
    expect(story.style.fill).toEqual({ type: 'solid', color: '#00ffff' });
    // mixed styling is kept as paragraph / character formatting (Layout rich text), so no first-style warning
    expect(r.warnings.some((w) => w.includes('first style'))).toBe(false);
    expect(story.spans?.length || story.paras?.some(Boolean)).toBeTruthy();

    // shapes
    const red = p1.find((n) => n.name === 'Red box') as RectNode;
    expect(red.type).toBe('rect');
    expect(red.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(red.stroke.width).toBeCloseTo(2 * PX_PER_PT);
    expect([red.w, red.h].map((v) => Math.round(v))).toEqual([133, 133]);
    const oval = p1.find((n) => n.type === 'ellipse') as EllipseNode;
    expect(oval.fill).toEqual({ type: 'solid', color: '#ff8080' });
    const line = p1.find((n) => n.type === 'path') as PathNode;
    expect(line.closed).toBe(false);
    const group = p1.find((n) => n.type === 'group');
    expect(group && group.type === 'group' && group.children).toHaveLength(2);

    // embedded image placed in its frame
    const frame = p1.find((n) => n.type === 'imageframe') as ImageFrameNode;
    expect(frame.assetId).toBeTruthy();
    expect(r.encoded.get(frame.assetId!)?.mime).toBe('image/png');
    expect(frame.fit).toBe('none');
    expect(frame.contentScale).toBeCloseTo(0.5 * PX_PER_PT * 0.75 / 0.75, 1);
  });

  it('resolves linked images through the resolver and reports missing ones', async () => {
    const asked: string[] = [];
    const r = await importIdml(await sampleIdml({ linked: true }), 'Linked', async (uri) => {
      asked.push(uri);
      return new Uint8Array(png);
    });
    expect(asked).toEqual(['file:/Users/teacher/Pictures/gradient.png']);
    expect((r.doc.pages[0].nodes.find((n) => n.type === 'imageframe') as ImageFrameNode).assetId).toBeTruthy();

    const missing = await importIdml(await sampleIdml({ linked: true }), 'Linked');
    expect(missing.warnings.some((w) => w.includes('linked image'))).toBe(true);
  });

  it('rejects files that are not IDML', async () => {
    const z = new JSZip();
    z.file('mimetype', 'application/epub+zip');
    await expect(importIdml(await z.generateAsync({ type: 'uint8array' }), 'x')).rejects.toThrow(/IDML/);
  });
});
