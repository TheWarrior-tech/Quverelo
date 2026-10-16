import { describe, expect, it } from 'vitest';
import { createDocument, createMaster, findNode, make } from '../../src/core/document';
import { addNodes, addTextFrame, appendStory, linkFrames, setStoryText } from '../../src/core/commands';
import {
  applyMasterToPages, autoFlow, fieldContext, formatPageNumber, frameExclusions, insertPages, masterItemsFor, overrideAllMasterItems,
  overrideMasterItem, pageLabel, removeMasterOverrides, setPageSection, spreadPartner, spreadsOf, toRoman,
} from '../../src/core/layout';
import { flowRichStory, monoMeasure } from '../../src/core/textflow';
import { applyCharProps, sheetOf } from '../../src/core/typography';
import { createStory } from '../../src/core/document';
import type { QuvreloDocument, SceneNode } from '../../src/core/types';

const m = monoMeasure(0.5);
const flowIn = (d: QuvreloDocument, storyId: string) => {
  const s = d.stories[storyId];
  const frames = s.chain.map((id) => findNode(d, id)!.node).filter((n): n is Extract<SceneNode, { type: 'textframe' }> => n.type === 'textframe');
  return flowRichStory(s, sheetOf(d), frames, m);
};

describe('page numbering and sections', () => {
  it('formats roman and alphabetic numbers', () => {
    expect(toRoman(1994)).toBe('mcmxciv');
    expect(formatPageNumber(4, 'ROMAN')).toBe('IV');
    expect(formatPageNumber(28, 'alpha')).toBe('ab');
  });
  it('restarts numbering at a section start', () => {
    let doc = createDocument({ pages: 6 });
    doc = setPageSection(doc, doc.pages[0].id, { name: 'Front matter', startAt: 1, style: 'roman' });
    doc = setPageSection(doc, doc.pages[3].id, { name: 'Chapter 1', startAt: 1, style: 'arabic', prefix: '1-' });
    expect(doc.pages.map((_, i) => pageLabel(doc, i))).toEqual(['i', 'ii', 'iii', '1-1', '1-2', '1-3']);
    expect(fieldContext(doc, 4)).toEqual({ page: '1-2', pageCount: '6', section: 'Chapter 1' });
    doc = setPageSection(doc, doc.pages[3].id, null);
    expect(pageLabel(doc, 3)).toBe('iv');
  });
});

describe('pages and spreads', () => {
  it('inserts several pages with a master and renumbers', () => {
    const doc = createDocument({ pages: 2 });
    const r = insertPages(doc, 0, 3, null);
    expect(r.doc.pages.map((p) => p.name)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Page 5']);
    expect(r.doc.pages[1].id).toBe(r.pageIds[0]);
  });
  it('groups facing pages into spreads', () => {
    expect(spreadsOf(5, true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(spreadsOf(2, false)).toEqual([[0], [1]]);
    expect(spreadPartner(5, true, 1)).toBe(2);
    expect(spreadPartner(5, true, 4)).toBe(3);
    expect(spreadPartner(5, true, 0)).toBe(-1);
  });
});

describe('master pages and overrides', () => {
  function withMaster() {
    let doc = createDocument({ pages: 3 });
    const footer = make.rect({ name: 'Footer bar', x: 100, y: 1000 });
    const master = createMaster('A-Master', [footer]);
    doc = { ...doc, masters: [master] };
    doc = applyMasterToPages(doc, master.id, doc.pages.map((p) => p.id));
    const t = addTextFrame(doc, master.id, { x: 200, y: 50 }, 'Running head');
    return { doc: t.doc, master, footer, headId: t.id };
  }
  it('applies a master to many pages', () => {
    const { doc, master } = withMaster();
    expect(doc.pages.every((p) => p.masterId === master.id)).toBe(true);
    expect(masterItemsFor(doc, doc.pages[0])).toHaveLength(2);
  });
  it('overriding copies the item to the page and hides the master one there only', () => {
    const { doc, footer } = withMaster();
    const r = overrideMasterItem(doc, doc.pages[1].id, footer.id);
    const p1 = r.doc.pages[1];
    expect(p1.nodes[0].overrideOf).toBe(footer.id);
    expect(masterItemsFor(r.doc, p1).map((n) => n.id)).not.toContain(footer.id);
    expect(masterItemsFor(r.doc, r.doc.pages[0]).map((n) => n.id)).toContain(footer.id);
  });
  it('an overridden text frame gets its own story', () => {
    const { doc, headId } = withMaster();
    const r = overrideMasterItem(doc, doc.pages[0].id, headId);
    const copy = r.doc.pages[0].nodes.find((n) => n.id === r.nodeId)! as Extract<SceneNode, { type: 'textframe' }>;
    const masterFrame = findNode(r.doc, headId)!.node as Extract<SceneNode, { type: 'textframe' }>;
    expect(copy.storyId).not.toBe(masterFrame.storyId);
    const edited = setStoryText(r.doc, copy.storyId, 'Chapter one');
    expect(edited.stories[masterFrame.storyId].text).toBe('Running head');
  });
  it('override all, then remove overrides restores the master', () => {
    const { doc } = withMaster();
    const pid = doc.pages[2].id;
    const all = overrideAllMasterItems(doc, pid);
    expect(all.pages[2].nodes).toHaveLength(2);
    expect(masterItemsFor(all, all.pages[2])).toHaveLength(0);
    const back = removeMasterOverrides(all, pid);
    expect(back.pages[2].nodes).toHaveLength(0);
    expect(back.pages[2].overrides).toBeUndefined();
    expect(masterItemsFor(back, back.pages[2])).toHaveLength(2);
    expect(Object.keys(back.stories)).toHaveLength(Object.keys(doc.stories).length);
  });
});

describe('auto-flow', () => {
  it('adds pages and linked frames until the story fits', () => {
    let doc = createDocument({ pages: 1, settings: { width: 400, height: 400 } });
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const t = addTextFrame(doc, doc.pages[0].id, { x: 200, y: 200, w: 200, h: 100 }, text, { fontSize: 10, lineHeight: 1 });
    doc = t.doc;
    expect(flowIn(doc, (findNode(doc, t.id)!.node as Extract<SceneNode, { type: 'textframe' }>).storyId).overflow).toBe(true);
    const r = autoFlow(doc, t.id, flowIn);
    expect(r.pagesAdded).toBeGreaterThan(3);
    expect(r.doc.pages).toHaveLength(1 + r.pagesAdded);
    const sid = (findNode(r.doc, t.id)!.node as Extract<SceneNode, { type: 'textframe' }>).storyId;
    expect(r.doc.stories[sid].chain).toHaveLength(1 + r.pagesAdded);
    expect(flowIn(r.doc, sid).overflow).toBe(false);
    // the new frames copy the first frame's geometry
    const f2 = findNode(r.doc, r.doc.stories[sid].chain[1])!.node as Extract<SceneNode, { type: 'textframe' }>;
    expect([f2.w, f2.h, f2.x, f2.y]).toEqual([200, 100, 200, 200]);
  });
  it('stops when a new frame would take nothing', () => {
    let doc = createDocument();
    const t = addTextFrame(doc, doc.pages[0].id, { w: 4, h: 4 }, 'abc', { fontSize: 10, lineHeight: 1 });
    doc = t.doc;
    expect(autoFlow(doc, t.id, flowIn).pagesAdded).toBeLessThanOrEqual(1);
  });
});

describe('text wrap exclusions', () => {
  it('maps a wrapped object into the frame\'s top-left space with its offset', () => {
    let doc = createDocument();
    const t = addTextFrame(doc, doc.pages[0].id, { x: 200, y: 200, w: 200, h: 200 }, 'x');
    doc = addNodes(t.doc, doc.pages[0].id, [make.rect({ x: 200, y: 150, w: 40, h: 20, wrap: { mode: 'box', offset: 4 } })]);
    const ex = frameExclusions(doc, t.id);
    expect(ex).toHaveLength(1);
    const xs = ex[0].pts.map((p) => p.x);
    const ys = ex[0].pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(80);
    expect(Math.max(...xs)).toBeCloseTo(120);
    expect(Math.min(...ys)).toBeCloseTo(40);
    expect(ex[0].offset).toBe(4);
  });
  it('contour wrap follows an ellipse outline', () => {
    let doc = createDocument();
    const t = addTextFrame(doc, doc.pages[0].id, { x: 200, y: 200, w: 200, h: 200 }, 'x');
    doc = addNodes(t.doc, doc.pages[0].id, [make.ellipse({ x: 200, y: 200, w: 100, h: 100, wrap: { mode: 'contour', offset: 0 } })]);
    const ex = frameExclusions(doc, t.id);
    expect(ex[0].kind).toBe('contour');
    expect(ex[0].pts.length).toBeGreaterThan(8);
  });
  it('items without wrap do not exclude', () => {
    let doc = createDocument();
    const t = addTextFrame(doc, doc.pages[0].id, { x: 200, y: 200 }, 'x');
    doc = addNodes(t.doc, doc.pages[0].id, [make.rect({ x: 200, y: 200 })]);
    expect(frameExclusions(doc, t.id)).toEqual([]);
  });
});

describe('story formatting survives linking', () => {
  it('appends a story with its formatting shifted', () => {
    let a = createStory('ab', {});
    let b = createStory('cd', {});
    b = applyCharProps(b, 0, 1, { italic: true });
    a = appendStory(a, b);
    expect(a.text).toBe('ab\ncd');
    expect(a.spans).toEqual([{ start: 3, end: 4, styleId: null, props: { italic: true } }]);
  });
  it('linkFrames keeps formatting of the absorbed story', () => {
    let doc = createDocument();
    const a = addTextFrame(doc, doc.pages[0].id, {}, 'one');
    const b = addTextFrame(a.doc, doc.pages[0].id, {}, 'two');
    doc = b.doc;
    const sid = (findNode(doc, b.id)!.node as Extract<SceneNode, { type: 'textframe' }>).storyId;
    doc = { ...doc, stories: { ...doc.stories, [sid]: applyCharProps(doc.stories[sid], 0, 3, { fontWeight: 700 }) } };
    doc = linkFrames(doc, a.id, b.id);
    const merged = doc.stories[(findNode(doc, a.id)!.node as Extract<SceneNode, { type: 'textframe' }>).storyId];
    expect(merged.text).toBe('one\ntwo');
    expect(merged.spans![0]).toMatchObject({ start: 4, end: 7 });
  });
});
